import Icon from '../Icon/Icon'
import './SearchField.css'

type Props = { label: string; placeholder: string; value: string; onChange: (value: string) => void }
export default function SearchField({ label, placeholder, value, onChange }: Props) {
  return <div className="music-search"><Icon name="search" /><input aria-label={label} placeholder={placeholder} value={value} onChange={(event) => onChange(event.target.value)} /></div>
}
