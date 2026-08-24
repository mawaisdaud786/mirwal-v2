import { useState } from 'react'

const FaIcon = ({ name }) => <i className={`fa-solid fa-${name}`} aria-hidden="true" />

function navigate(path) {
  window.history.pushState({}, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

export default function Header({ cartCount = 0 }) {
  const [category, setCategory] = useState('All Categories')
  const categories = ['All Categories', 'Electronics', 'Home & Living', 'Fashion', 'Beauty & Health']

  return <>
    <div className="utility"><span><FaIcon name="location-dot" /> Delivering to <b>Lahore, Pakistan</b></span><strong><FaIcon name="wand-magic-sparkles" /> Smart Shopping, Better Living</strong><span><button type="button" onClick={() => navigate('/sell-with-mirwal')}><FaIcon name="store" /> Become a Seller</button><a href="mailto:support@mirwal.com"><FaIcon name="headset" /> Help &amp; Support</a><button type="button" onClick={() => navigate('/login')}><FaIcon name="cube" /> Track Order</button></span></div>
    <header className="header container">
      <div className="brand"><span className="brand-mark">M</span><div><b>MIRWAL</b><small>All finds. You choose.</small></div></div>
      <div className="search"><div className="search-category dropdown"><button className="search-category-toggle dropdown-toggle" type="button" data-bs-toggle="dropdown" aria-expanded="false">{category}</button><ul className="dropdown-menu dropdown-menu-start">{categories.map((item) => <li key={item}><button className="dropdown-item" type="button" onClick={() => setCategory(item)}>{item}</button></li>)}</ul></div><FaIcon name="magnifying-glass" /><input className="form-control" type="search" placeholder="Search for products, brands or solve your shopping problem..." aria-label="Search products" /><button className="btn" type="button" aria-label="Search"><FaIcon name="magnifying-glass" /></button></div>
      <div className="actions"><button type="button" onClick={() => navigate('/compare')}><span className="action-icon"><FaIcon name="scale-balanced" /><i>0</i></span><span>Compare</span></button><button type="button"><span className="action-icon"><FaIcon name="heart" /><i>0</i></span><span>Wishlist</span></button><button type="button" onClick={() => navigate('/cart')}><span className="action-icon"><FaIcon name="cart-shopping" /><i>{cartCount}</i></span><span>Cart</span></button></div>
    </header>
    <nav className="nav container"><div className="category-dropdown dropdown"><button className="category-button btn btn-primary dropdown-toggle" type="button" data-bs-toggle="dropdown" aria-expanded="false"><FaIcon name="bars" /> All Categories</button><ul className="dropdown-menu"><li><a className="dropdown-item" href="#electronics">Electronics</a></li><li><a className="dropdown-item" href="#home-living">Home & Living</a></li><li><a className="dropdown-item" href="#fashion">Fashion</a></li><li><a className="dropdown-item" href="#beauty-health">Beauty & Health</a></li><li><a className="dropdown-item" href="#sports-outdoors">Sports & Outdoors</a></li><li><a className="dropdown-item" href="#baby-toys">Baby & Toys</a></li><li><a className="dropdown-item" href="#automotive">Automotive</a></li></ul></div><div className="links"><a className="active" onClick={() => navigate('/')}><FaIcon name="house" /> Home</a><a className="explore-nav-link" onClick={() => navigate('/explore')}><FaIcon name="grip" /> Explore</a><a className="deals-nav-link" onClick={() => navigate('/deals')}><FaIcon name="tag" /> Deals</a><a onClick={() => navigate('/compare')}><FaIcon name="scale-balanced" /> Compare</a><a onClick={() => navigate('/ai-assistant')}><FaIcon name="wand-magic-sparkles" /> AI Solution <em>New</em></a><a><FaIcon name="pen-to-square" /> Blog</a></div><button className="login btn btn-outline-primary" type="button" onClick={() => navigate('/login')}><FaIcon name="user" /> Login / Register</button></nav>
  </>
}
