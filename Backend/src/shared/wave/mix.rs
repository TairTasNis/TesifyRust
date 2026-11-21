use super::{
    lastfm::Source,
    profile::{Analysis, genre_factor},
    random, weighted,
};
use serde::Deserialize;

#[derive(Clone, Copy, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Options {
    pub mode: Mode,
    pub mood: Mood,
}

#[derive(Clone, Copy, Default, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum Mode {
    #[default]
    Balanced,
    Familiar,
    Discovery,
    Popular,
}

impl Mode {
    pub fn similar(self, draw: f64) -> bool {
        draw < match self {
            Self::Balanced => 0.7,
            Self::Familiar => 0.9,
            Self::Discovery => 0.4,
            Self::Popular => 0.0,
        }
    }
}

#[derive(Clone, Copy, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Mood {
    #[default]
    Any,
    Sad,
    Happy,
    Energetic,
    Calm,
    Romantic,
    Focused,
}

impl Mood {
    pub fn tags(self) -> &'static [&'static str] {
        match self {
            Self::Any => &[],
            Self::Sad => &["sad", "melancholy"],
            Self::Happy => &["happy", "feel good"],
            Self::Energetic => &["energetic", "upbeat"],
            Self::Calm => &["calm", "chillout"],
            Self::Romantic => &["romantic", "love songs"],
            Self::Focused => &["instrumental", "ambient"],
        }
    }
}

pub struct Feed {
    pub source: Source,
    pub tags: Vec<String>,
}

impl Feed {
    pub fn tag(tag: &str) -> Self {
        Self {
            source: Source::Tag(tag.into()),
            tags: vec![tag.into()],
        }
    }
}

pub fn personalized(analysis: &Analysis, mode: Mode) -> (Vec<Feed>, Vec<Feed>) {
    let seeds = sample(
        analysis
            .favorites
            .iter()
            .map(|favorite| {
                (
                    favorite,
                    if mode == Mode::Familiar {
                        favorite.weight
                    } else {
                        favorite.weight.sqrt()
                    },
                )
            })
            .collect(),
    );
    let similar = seeds
        .into_iter()
        .map(|seed| Feed {
            source: Source::Similar(seed.song.clone()),
            tags: seed.tags.clone(),
        })
        .collect();
    let tags = sample(
        analysis
            .tags
            .iter()
            .filter(|tag| tag.weight > 0.0)
            .map(|tag| {
                (
                    tag,
                    if mode == Mode::Discovery {
                        (tag.playlist_tracks as f64 + tag.feedback).sqrt() * genre_factor(&tag.tag)
                    } else {
                        tag.weight
                    },
                )
            })
            .collect(),
    );
    (
        similar,
        tags.into_iter().map(|tag| Feed::tag(&tag.tag)).collect(),
    )
}

fn sample<T: Copy>(mut choices: Vec<(T, f64)>) -> Vec<T> {
    let mut selected = Vec::new();
    for _ in 0..3 {
        let Some(index) = weighted(
            choices
                .iter()
                .enumerate()
                .map(|(index, (_, weight))| (index, *weight)),
        ) else {
            break;
        };
        selected.push(choices.swap_remove(index).0);
    }
    selected
}

pub fn rank(rank: usize, mode: Mode) -> f64 {
    random().powf(((rank + 1) as f64).powf(if mode == Mode::Discovery { 0.3 } else { 0.6 }))
}

pub type SongKey = (String, String);

pub fn interleave<T>(slots: &[bool], similar: Vec<T>, tags: Vec<T>) -> Vec<T> {
    let mut similar = similar.into_iter();
    let mut tags = tags.into_iter();
    slots
        .iter()
        .filter_map(|slot| {
            if *slot {
                similar.next().or_else(|| tags.next())
            } else {
                tags.next().or_else(|| similar.next())
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mix_uses_seventy_percent_similar_and_interleaves_both_sources() {
        let slots: Vec<_> = (0..10)
            .map(|draw| Mode::Balanced.similar((draw as f64 + 0.5) / 10.0))
            .collect();
        assert_eq!(slots.iter().filter(|&&similar| similar).count(), 7);
        assert_eq!(
            interleave(&[true, false, true], vec![1, 2], vec![3]),
            [1, 3, 2]
        );
        assert_eq!(
            interleave(&[true, false, true], vec![1], vec![3, 4]),
            [1, 3, 4]
        );
    }
}
