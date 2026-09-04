export default function Icon({ name, className = '' }) {
  return <i className={`fa-solid fa-${name}${className ? ` ${className}` : ''}`} aria-hidden="true" />
}
