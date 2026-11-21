import { useState } from 'react'

// The artwork itself supplies the palette, including when its host disallows canvas/CORS.
export default function LyricsBackground({ coverUrl, playing, mobile }: { coverUrl: string | null; playing: boolean; mobile: boolean }) {
  const [failed, setFailed] = useState<string | null>(null)
  return <div className="lyrics-background" aria-hidden="true" data-playing={playing}>
    <div className="lyrics-background-base" />
    {coverUrl && failed !== coverUrl && <Artwork key={coverUrl} url={coverUrl} mobile={mobile} onError={() => setFailed(coverUrl)} />}
    <div className="lyrics-background-shade" />
  </div>
}

function Artwork({ url, mobile, onError }: { url: string; mobile: boolean; onError: () => void }) {
  const [ready, setReady] = useState(false)
  return <div className="lyrics-background-art" data-ready={ready || undefined}>
    {(mobile ? [0] : [0, 1, 2]).map((layer) => <div className={`lyrics-background-orbit lyrics-background-orbit--${layer}`} key={layer}>
      <img src={url} alt="" decoding="async" onLoad={() => setReady(true)} onError={onError} draggable={false} />
    </div>)}
  </div>
}
