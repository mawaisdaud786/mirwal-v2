import { useContext } from 'react'
import { navigateTo, SiteChromeContext } from '../navigation'

export default function Footer({ global = false }) {
  const chromeIsMounted = useContext(SiteChromeContext)
  if (chromeIsMounted && !global) return null
  return <footer><div className="footer-inner container"><div className="footer-brand"><div className="brand"><span className="brand-mark">M</span><div><b>MIRWAL</b><small>All finds. You choose.</small></div></div><p>Mirwal is your smart shopping assistant<br />that helps you discover, compare<br />and choose the right products<br />with confidence.</p></div>{[['Customer Service','Help Center','How Mirwal Works','Track Order','Return & Refund'],['Company','About Us','Careers','Press & Media','Terms & Conditions'],['For Sellers','Become a Seller','Seller Center','Seller Guidelines','Pricing & Plans'],['Download App','Google Play','App Store']].map(([title,...items]) => <div className="footer-col" key={title}><b>{title}</b>{items.map((item) => item === 'Help Center' ? <button type="button" key={item} onClick={() => navigateTo('/help-center')}>{item}</button> : item === 'About Us' ? <button type="button" key={item} onClick={() => navigateTo('/about')}>{item}</button> : <a key={item}>{item}</a>)}</div>)}</div><div className="copyright container">© 2025 Mirwal. All rights reserved. <span>Privacy Policy &nbsp; Terms of Service</span></div></footer>
}
