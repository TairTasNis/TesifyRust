import type { SVGProps } from 'react'
import logo from '../../assets/tesify-logo-2k.png'

export default function Logo(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="304 424 1440 1320"
      fill="none"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <image href={logo} width="2048" height="2048" />
    </svg>
  )
}
