import { useContext } from 'react'
import { navigateTo, SiteChromeContext } from '@mirwal/shared/navigation'

const footerRoutes = { 'Help Center': '/help-center', 'How Mirwal Works': '/about', 'Track Order': '/track-orders', 'Return & Refund': '/returns', 'About Us': '/about', 'Terms & Conditions': '/terms', 'Privacy Policy': '/privacy', 'Terms of Service': '/terms', 'Guides': '/guides', 'Brands': '/brands', 'Sellers': '/sellers', 'New Arrivals': '/new-arrivals', 'Featured': '/featured', 'Contact': '/contact', 'Become a Seller': '/sell-with-mirwal', 'Seller Guidelines': '/help-center', 'Pricing & Plans': '/sell-with-mirwal' }

/**
 * "Seller Center" is the one place the public storefront deliberately points at another
 * Mirwal application: an existing seller looking for their dashboard. The dashboard lives on
 * seller.mirwal.pk and is not reachable from this bundle, so this has to be a real anchor —
 * `navigateTo` only drives the storefront's own router, which is why this entry used to point
 * at a bare `/seller` that matched no route (the seller routes here all require a slug) and
 * dead-ended on the 404 page.
 *
 * When VITE_SELLER_URL is unset (local dev, preview builds) it falls back to the public
 * onboarding page rather than emitting a link to a host that does not exist.
 */
const footerExternalLinks = { 'Seller Center': import.meta.env.VITE_SELLER_URL || '' }

export default function Footer({ global = false }) {
  const chromeIsMounted = useContext(SiteChromeContext)
  if (chromeIsMounted && !global) return null
  return <footer><div className="footer-inner container"><div className="footer-brand"><div className="brand"><span className="brand-mark">M</span><div><b>MIRWAL</b><small>All finds. You choose.</small></div></div><p>Mirwal is your smart shopping assistant<br />that helps you discover, compare<br />and choose the right products<br />with confidence.</p></div>{[['Customer Service','Help Center','How Mirwal Works','Track Order','Return & Refund'],['Company','About Us','Careers','Press & Media','Terms & Conditions','Privacy Policy','Contact'],['Marketplace','Guides','Brands','Sellers','New Arrivals','Featured'],['For Sellers','Become a Seller','Seller Center','Seller Guidelines','Pricing & Plans'],['Download App','Google Play','App Store']].map(([title,...items]) => <div className="footer-col" key={title}><b>{title}</b>{items.map((item) => footerExternalLinks[item] ? <a key={item} href={footerExternalLinks[item]} rel="noopener noreferrer">{item}</a> : footerRoutes[item] ? <button type="button" key={item} onClick={() => navigateTo(footerRoutes[item])}>{item}</button> : item in footerExternalLinks ? <button type="button" key={item} onClick={() => navigateTo('/sell-with-mirwal')}>{item}</button> : <span key={item}>{item}</span>)}</div>)}</div><div className="copyright container">© 2026 Mirwal. All rights reserved. <span>Privacy Policy &nbsp; Terms of Service</span></div></footer>
}
