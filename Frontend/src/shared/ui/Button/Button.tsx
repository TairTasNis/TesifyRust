import type { ButtonHTMLAttributes } from 'react'
import './Button.css'

type Props = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger' }

export default function Button({ variant = 'primary', className = '', type = 'button', ...props }: Props) {
  return <button className={`music-button music-button--${variant} ${className}`} type={type} {...props} />
}
