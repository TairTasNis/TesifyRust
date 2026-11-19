import './MusicLoader.css'

type Props = { label: string; variant?: 'page' | 'inline' | 'compact' | 'spinner'; className?: string }

export default function MusicLoader({ label, variant = 'page', className = '' }: Props) {
  return (
    <span className={`music-loader music-loader--${variant} ${className}`} role="status" aria-label={label}>
      {variant === 'page' && <span className="music-loader-turntable" aria-hidden="true">
        <span className="music-loader-record"><span className="music-loader-record-label" /></span>
        <span className="music-loader-arm" />
      </span>}
      {variant === 'spinner' ? <span className="music-loader-ring" aria-hidden="true" />
        : <span className="music-loader-bars" aria-hidden="true"><i /><i /><i /><i /><i /></span>}
      {(variant === 'page' || variant === 'inline') && <span className="music-loader-label" aria-hidden="true">{label}</span>}
    </span>
  )
}
