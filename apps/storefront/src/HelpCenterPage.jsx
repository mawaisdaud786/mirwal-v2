import { useMemo, useState } from 'react'
import Header from './components/Header'
import Footer from './components/Footer'
import './help-center.css'

const FaIcon = ({ name }) => <i className={`fa-solid fa-${name}`} aria-hidden="true" />

const topics = [
  ['truck-fast', 'Orders & Delivery', 'Track orders, delivery issues, shipping info'],
  ['rotate-left', 'Returns & Refunds', 'Return process, refund status, exchange'],
  ['credit-card', 'Payments & Wallet', 'Payment methods, wallet, failed payments'],
  ['user', 'Account & Security', 'Login issues, password, account settings'],
  ['wand-magic-sparkles', 'Products & Services', 'Product info, availability, warranties'],
  ['tag', 'Offers & Coupons', 'Coupons, discounts, loyalty & rewards'],
  ['headset', 'Marketplace Help', 'Seller, store and marketplace related help'],
]
const articles = ['How do I track my order?', 'How can I return or exchange a product?', 'What payment methods are accepted?', 'How do I cancel my order?', 'How long does delivery take?', 'How can I update my delivery address?', 'When will I get my refund?', 'How do I apply a coupon code?']
const quickLinks = [['truck-fast', 'Track Your Order', 'Check real-time status of your order'], ['rotate-left', 'Returns & Refunds', 'Start a return or check refund status'], ['circle-xmark', 'Cancel Order', 'Request cancellation of your order'], ['credit-card', 'Payments & Wallet', 'Payment methods, failed payments & more'], ['user', 'Account & Profile', 'Update profile, address or security'], ['headset', 'Contact Support', "We're here to help you anytime"]]
const contactOptions = [['phone', 'Get a Call Back', 'Share your number and our support team will call you.', 'Request Call Back', 'support-call'], ['envelope', 'Email Us', "Write to us and we'll get back to you.", 'Send Email', 'support-email'], ['whatsapp', 'WhatsApp Us', 'Chat with us on WhatsApp for quick help.', 'Chat on WhatsApp', 'support-whatsapp'], ['pen-to-square', 'Submit a Request', "Fill a short form and we'll solve your issue.", 'Submit Request', 'support-request']]

export default function HelpCenterPage({ cartCount }) {
  const [query, setQuery] = useState('')
  const [submitted, setSubmitted] = useState('')
  const normalizedQuery = query.trim().toLowerCase()
  const filteredTopics = useMemo(() => topics.filter(([, title, copy]) => `${title} ${copy}`.toLowerCase().includes(normalizedQuery)), [normalizedQuery])
  const filteredArticles = useMemo(() => articles.filter((article) => article.toLowerCase().includes(normalizedQuery)), [normalizedQuery])
  const showMessage = (message) => { setSubmitted(message); window.setTimeout(() => setSubmitted(''), 2600) }
  const search = (event) => { event.preventDefault(); document.querySelector('.help-results')?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }

  return <div className="help-page"><Header cartCount={cartCount} /><main>
    <section className="help-hero"><div className="help-hero-inner container"><div className="help-hero-copy"><h1>How can we <span>help</span> you?</h1><p>Find solutions, get instant answers or connect with us<br />in the easiest way possible.</p><form className="help-search" onSubmit={search}><FaIcon name="magnifying-glass" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search for help articles, topics or keywords..." aria-label="Search help articles" /><button type="submit" aria-label="Search"><FaIcon name="arrow-right" /></button></form><div className="popular-searches"><small>Popular searches:</small>{['Track Order', 'Return Policy', 'Cancel Order', 'Payment Help'].map((item) => <button type="button" key={item} onClick={() => setQuery(item)}>{item}</button>)}</div></div><div className="help-hero-art" aria-hidden="true"><div className="help-ring"><span className="help-ring-inner"><FaIcon name="message" /><b>•••</b></span></div><span className="help-art-icon art-truck"><FaIcon name="truck" /></span><span className="help-art-icon art-card"><FaIcon name="credit-card" /></span><span className="help-art-icon art-box"><FaIcon name="cube" /></span><span className="help-art-icon art-shield"><FaIcon name="shield-halved" /></span></div></div></section>

    <section className="help-results container"><div className="help-section-heading"><h2>Get help with</h2><button type="button" onClick={() => setQuery('')}>View all topics <FaIcon name="arrow-right" /></button></div><div className="quick-grid">{quickLinks.map(([icon, title, copy]) => <button className="quick-card" type="button" key={title} onClick={() => setQuery(title)}><span><FaIcon name={icon} /></span><b>{title}</b><small>{copy}</small><FaIcon name="arrow-right" /></button>)}</div>
      <div className="help-lists"><section className="help-list-panel"><div className="help-panel-heading"><h2>Browse help topics</h2><button type="button" onClick={() => setQuery('')}>View all topics <FaIcon name="arrow-right" /></button></div>{filteredTopics.length ? filteredTopics.map(([icon, title, copy]) => <button className="help-list-row" type="button" key={title} onClick={() => setQuery(title)}><FaIcon name={icon} /><b>{title}</b><small>{copy}</small><FaIcon name="chevron-right" /></button>) : <p className="help-empty">No topics match “{query}”.</p>}</section><section className="help-list-panel"><div className="help-panel-heading"><h2>Popular help articles</h2><button type="button" onClick={() => setQuery('')}>View all articles <FaIcon name="arrow-right" /></button></div>{filteredArticles.length ? filteredArticles.map((article) => <button className="help-list-row article-row" type="button" key={article} onClick={() => showMessage(`Opening: ${article}`)}><FaIcon name="file-lines" /><b>{article}</b><FaIcon name="chevron-right" /></button>) : <p className="help-empty">No articles match “{query}”.</p>}</section></div>

      <div className="help-section-heading contact-heading"><h2>Need more help? <small>Choose what's easiest for you.</small></h2></div><div className="contact-grid">{contactOptions.map(([icon, title, copy, action, className]) => <article className={`contact-card ${className}`} key={title}><span className="contact-icon"><FaIcon name={icon} /></span><div><b>{title}</b><p>{copy}</p><button type="button" onClick={() => title === 'Email Us' ? window.location.assign('mailto:support@mirwal.com') : title === 'WhatsApp Us' ? window.location.assign('https://wa.me/923001234567') : showMessage(`${action} request received.`)}>{action}</button><small><i />{title === 'Email Us' ? 'We reply within 24 hours' : title === 'Submit a Request' ? 'We will get back to you' : 'Available: 9AM – 9PM (Everyday)'}</small></div></article>)}</div><div className="help-trust"><span><FaIcon name="phone" /><b>Fast & Friendly Support</b><small>We're here to help you quickly and kindly</small></span><span><FaIcon name="shield-halved" /><b>Secure & Safe</b><small>Your privacy and data are fully protected</small></span><span><FaIcon name="heart" /><b>Reliable Solutions</b><small>We provide accurate and useful answers</small></span><span><FaIcon name="clock" /><b>Available Every Day</b><small>24/7 help center and multiple support options</small></span></div><p className="help-footer-line">Still need help? &nbsp; We're always here for you. <FaIcon name="heart" /></p></section>
    </main><Footer />{submitted && <div className="help-toast" role="status">{submitted}</div>}</div>
}
