import type { ReactNode, SVGProps } from 'react'

export type IconName =
  | 'dashboard'
  | 'home'
  | 'search'
  | 'library'
  | 'minimize'
  | 'maximize'
  | 'restore'
  | 'close'
  | 'back'
  | 'plus' | 'image' | 'import' | 'spotify' | 'chevron' | 'clock' | 'edit' | 'trash' | 'check'
  | 'play' | 'pause' | 'previous' | 'next' | 'volume' | 'muted'
  | 'sort-up'
  | 'artist'
  | 'lyrics'
  | 'settings'

type IconProps = SVGProps<SVGSVGElement> & { name: IconName }

const paths: Record<IconName, ReactNode> = {
  home: <path d="m3.5 10.4 7.2-6.4a2 2 0 0 1 2.6 0l7.2 6.4v8.2a1.9 1.9 0 0 1-1.9 1.9h-3.9v-5a1.6 1.6 0 0 0-1.6-1.6h-2.2a1.6 1.6 0 0 0-1.6 1.6v5H5.4a1.9 1.9 0 0 1-1.9-1.9z" />,
  dashboard: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </>
  ),
  search: (
    <>
      <circle cx="10.75" cy="10.75" r="7.25" />
      <path d="m16 16 4.5 4.5" />
    </>
  ),
  library: (
    <>
      <path d="M3 5h12M3 9h12M3 13h7M3 17h7" />
      <path d="M21 16.5V6" />
      <circle cx="18.5" cy="16.5" r="2.5" />
    </>
  ),
  minimize: <path d="M3 12h18" />,
  maximize: <path d="M3 3h18v18H3z" />,
  restore: (
    <>
      <path d="M8 3h13v13M3 8h13v13H3z" />
    </>
  ),
  close: <path d="m4 4 16 16M20 4 4 20" />,
  back: <path d="M19 12H5m6-6-6 6 6 6" />,
  plus: <path d="M12 5v14M5 12h14" />,
  image: <><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="m21 16-5-5L5 21" /></>,
  import: <><path d="M12 3v12m-4-4 4 4 4-4M4 16v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" /></>,
  spotify: <><circle cx="12" cy="12" r="10" fill="currentColor" stroke="none" /><path d="M6.5 9c3.6-1.1 7.4-.9 11 1M7.2 12.3c3.1-.8 6.4-.6 9.4 1M8 15.5c2.5-.6 5.1-.4 7.6.7" stroke="white" strokeWidth="1.5" /></>,
  chevron: <path d="m9 5 7 7-7 7" />,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  edit: <><path d="m15 4 5 5M4 20l1-6L16 3a2.1 2.1 0 0 1 3 0l2 2a2.1 2.1 0 0 1 0 3L10 19Z" /></>,
  trash: <><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7" /></>,
  check: <path d="m5 12 4 4L19 6" />,
  play: <path d="m9 5 11 7-11 7Z" fill="currentColor" stroke="none" />,
  pause: <><rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none" /><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none" /></>,
  previous: <><path d="m18 5-10 7 10 7Z" fill="currentColor" stroke="none" /><path d="M5 5v14" /></>,
  next: <><path d="m6 5 10 7-10 7Z" fill="currentColor" stroke="none" /><path d="M19 5v14" /></>,
  volume: <><path d="M11 4 6 8H3v8h3l5 4ZM15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14" /></>,
  muted: <><path d="M11 4 6 8H3v8h3l5 4ZM16 9l5 6M21 9l-5 6" /></>,
  'sort-up': <path d="m7 14 5-5 5 5" />,
  artist: <><circle cx="12" cy="8" r="4" /><path d="M4 21v-2a8 8 0 0 1 16 0v2" /></>,
  lyrics: <><rect x="3" y="3" width="18" height="15" rx="3" /><path d="M8 18v3l4-3M7 8h10M7 12h7" /></>,
  settings: <><path d="m10 3-.6 2.3-1.8 1L5.3 5.7 3.4 9l1.7 1.7v2.6L3.4 15l1.9 3.3 2.3-.6 1.8 1L10 21h4l.6-2.3 1.8-1 2.3.6 1.9-3.3-1.7-1.7v-2.6L20.6 9l-1.9-3.3-2.3.6-1.8-1L14 3z" /><circle cx="12" cy="12" r="3" /></>,
}

export default function Icon({ name, ...props }: IconProps) {
  return (
    <svg
      width="30"
      height="30"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {paths[name]}
    </svg>
  )
}
