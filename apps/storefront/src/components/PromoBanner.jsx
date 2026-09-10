import './promo-banner.css'

const FaIcon = ({ name }) => <i className={`fa-solid fa-${name}`} aria-hidden="true" />

/**
 * Generated on-brand illustration used only when a banner has no real product/category/
 * seller photo to show (e.g. an editorial guides page, or a seller directory landing with
 * no single seller to feature). It draws a shopping bag and a percentage tag in flat shapes —
 * decoration, not a photo standing in for a real product, and it makes no claim (no "50% OFF")
 * that would need real data behind it.
 */
function ShoppingBagIllustration() {
  return (
    <svg className="promo-illustration" viewBox="0 0 220 200" role="presentation" aria-hidden="true">
      <circle cx="110" cy="100" r="92" fill="var(--color-primary-light)" />
      <rect x="55" y="78" width="110" height="90" rx="14" fill="#ffffff" stroke="var(--color-primary)" strokeWidth="4" />
      <path d="M78 78 V58a32 32 0 0 1 64 0 V78" fill="none" stroke="var(--color-primary)" strokeWidth="8" strokeLinecap="round" />
      <circle cx="78" cy="94" r="6" fill="var(--color-primary)" />
      <circle cx="142" cy="94" r="6" fill="var(--color-primary)" />
      <g transform="translate(128 30) rotate(18)">
        <path d="M0 18a18 18 0 0 1 18-18h34l18 18-34 34a18 18 0 0 1-25 0L0 43a18 18 0 0 1 0-25z" fill="var(--color-accent)" />
        <circle cx="16" cy="16" r="5" fill="#ffffff" />
      </g>
    </svg>
  )
}

/**
 * One shared promotional banner, used everywhere a page needs a promo/ad slot. Every field
 * is a prop pulled from real data by the caller (a real product photo + its real discount, a
 * real category image, a real seller's own logo) — this component never invents a number or
 * a claim on its own. When a page genuinely has no product/category/seller to feature (an
 * editorial or directory page), pass no `image` and the generated illustration above is used
 * instead of a fabricated photo.
 */
export default function PromoBanner({ eyebrow, title, subtitle, ctaLabel, onCta, image, imageAlt = '', badge, variant = '' }) {
  return (
    <section className={`promo-banner${variant ? ` ${variant}` : ''}`}>
      <div className="promo-banner-copy">
        {eyebrow && <span className="promo-eyebrow">{eyebrow}</span>}
        <h2>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
        {ctaLabel && (
          <button type="button" onClick={onCta}>
            {ctaLabel} <FaIcon name="arrow-right" />
          </button>
        )}
      </div>
      <div className="promo-banner-visual">
        {badge && <span className="promo-banner-badge">{badge}</span>}
        {image ? <img src={image} alt={imageAlt} loading="lazy" /> : <ShoppingBagIllustration />}
      </div>
    </section>
  )
}
