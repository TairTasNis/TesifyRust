// YouTube's CDN can reject open-ended ranges; request bounded chunks instead.
pub const CHUNK_SIZE: u64 = 1024 * 1024;

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum AudioRange {
    Full,
    Bytes { start: u64, end: Option<u64> },
    Suffix(u64),
}

impl AudioRange {
    pub fn parse(value: Option<&str>) -> Option<Self> {
        let Some(value) = value else { return Some(Self::Full) };
        let (start, end) = value.trim().strip_prefix("bytes=")?.split_once('-')?;
        if start.is_empty() {
            let length = end.parse::<u64>().ok()?;
            return (length > 0).then_some(Self::Suffix(length));
        }
        let start = start.parse::<u64>().ok()?;
        let end = if end.is_empty() { None } else { Some(end.parse::<u64>().ok()?) };
        if end.is_some_and(|end| end < start) { return None; }
        Some(Self::Bytes { start, end })
    }

    pub fn initial_chunk(self) -> (u64, u64) {
        match self {
            Self::Full => (0, CHUNK_SIZE - 1),
            Self::Bytes { start, end } => (start, end.unwrap_or(u64::MAX).min(start.saturating_add(CHUNK_SIZE - 1))),
            Self::Suffix(_) => (0, 0), // Probe the file size before locating its tail.
        }
    }

    pub fn bounds(self, total: u64) -> Option<(u64, u64)> {
        if total == 0 { return None; }
        match self {
            Self::Full => Some((0, total - 1)),
            Self::Bytes { start, end } if start < total => Some((start, end.unwrap_or(total - 1).min(total - 1))),
            Self::Bytes { .. } => None,
            Self::Suffix(length) => Some((total.saturating_sub(length), total - 1)),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ContentRange {
    pub start: u64,
    pub end: u64,
    pub total: u64,
}

impl ContentRange {
    pub fn parse(value: &str) -> Option<Self> {
        let (span, total) = value.strip_prefix("bytes ")?.split_once('/')?;
        let (start, end) = span.split_once('-')?;
        let range = Self { start: start.parse().ok()?, end: end.parse().ok()?, total: total.parse().ok()? };
        (range.start <= range.end && range.end < range.total).then_some(range)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bounds_open_ended_and_full_requests() {
        let full = AudioRange::parse(None).unwrap();
        assert_eq!(full.initial_chunk(), (0, CHUNK_SIZE - 1));
        assert_eq!(full.bounds(3_333_671), Some((0, 3_333_670)));
        let seek = AudioRange::parse(Some("bytes=65536-")).unwrap();
        assert_eq!(seek.initial_chunk(), (65_536, 65_536 + CHUNK_SIZE - 1));
        assert_eq!(seek.bounds(3_333_671), Some((65_536, 3_333_670)));
    }

    #[test]
    fn resolves_tail_and_clamps_finite_ranges() {
        let tail = AudioRange::parse(Some("bytes=-65536")).unwrap();
        assert_eq!(tail.initial_chunk(), (0, 0));
        assert_eq!(tail.bounds(100_000), Some((34_464, 99_999)));
        assert_eq!(tail.bounds(100), Some((0, 99)));
        let finite = AudioRange::parse(Some("bytes=10-99999")).unwrap();
        assert_eq!(finite.bounds(100), Some((10, 99)));
        assert_eq!(AudioRange::parse(Some("bytes=100-200")).unwrap().bounds(100), None);
    }

    #[test]
    fn rejects_invalid_ranges_without_overflow() {
        for value in ["bytes=3-2", "bytes=-0", "bytes=0-1,3-4", "bytes=-", "other=0-1"] {
            assert_eq!(AudioRange::parse(Some(value)), None);
        }
        assert_eq!(AudioRange::parse(Some("bytes=18446744073709551615-")).unwrap().initial_chunk(), (u64::MAX, u64::MAX));
    }

    #[test]
    fn validates_upstream_content_range() {
        assert_eq!(ContentRange::parse("bytes 0-65535/3333671"), Some(ContentRange { start: 0, end: 65535, total: 3333671 }));
        for value in ["bytes */100", "bytes 0-100/100", "bytes 10-0/100", "bytes 0-9/*"] {
            assert_eq!(ContentRange::parse(value), None);
        }
    }
}
