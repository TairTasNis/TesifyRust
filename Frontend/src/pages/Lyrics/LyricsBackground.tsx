import { useState } from 'react'

// The artwork itself supplies the palette, including when its host disallows canvas/CORS.
export default function LyricsBackground({ coverUrl, playing }: { coverUrl: string | null; playing: boolean }) {
  const [failed, setFailed] = useState<string | null>(null)
  return <div className="lyrics-background" aria-hidden="true" data-playing={playing}>
    <div className="lyrics-background-base" />
    {coverUrl && failed !== coverUrl && <Artwork key={coverUrl} url={coverUrl} onError={() => setFailed(coverUrl)} />}
    <div className="lyrics-background-shade" />
  </div>
}

function Artwork({ url, onError }: { url: string; onError: () => void }) {
  const [ready, setReady] = useState(false)
  return <div className="lyrics-background-art" data-ready={ready || undefined}>
    {[0, 1, 2].map((layer) => <div className={`lyrics-background-orbit lyrics-background-orbit--${layer}`} key={layer}>
      <img src={url} alt="" onLoad={() => setReady(true)} onError={onError} draggable={false} />
    </div>)}
  </div>
}
