import { Link } from 'react-router-dom'
import categoriesBanner from './assets/images/categories banner.png'
import './categories-page.css'

const Icon = ({ name }) => <i className={`fa-solid fa-${name}`} aria-hidden="true" />

export default function MarketplaceLandingSections({ needs, bannerAlt }) {
  return <>
    <section className="category-hero-banner" aria-label="Explore marketplace">
      <img className="category-banner-image" src={categoriesBanner} alt={bannerAlt} />
    </section>
    <section className="category-needs-section">
      <div className="category-section-heading">
        <div><span className="category-eyebrow">SHOP WITH A GOAL</span><h2>Shop by Need</h2></div>
        <Link to="/ai-shopping">Not sure what you need? Ask Mirwal AI <Icon name="arrow-right" /></Link>
      </div>
      <div className="need-grid">
        {needs.map(([label, icon, query]) => (
          <Link to={`/explore?search=${encodeURIComponent(query)}`} key={label}>
            <span><Icon name={icon} /></span>
            <strong>{label}</strong>
            <Icon name="arrow-right" />
          </Link>
        ))}
      </div>
    </section>
    <section className="category-ai-cta" aria-label="Mirwal AI shopping assistant">
      <div>
        <span className="category-ai-label"><Icon name="robot" /> MIRWAL AI</span>
        <h2>Still deciding? Let’s narrow it down.</h2>
        <p>Tell Mirwal what matters to you and get a shortlist worth comparing.</p>
      </div>
      <Link to="/ai-shopping"><Icon name="robot" /> Ask Mirwal AI</Link>
    </section>
  </>
}
