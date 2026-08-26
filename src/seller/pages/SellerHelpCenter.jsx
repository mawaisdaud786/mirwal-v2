import { useMemo, useState } from 'react'
import SellerLayout from '../SellerLayout'
import { navigateTo } from '../../navigation'
import './seller-help-center.css'

const categories = [
  { title: 'Getting Started', description: 'Start selling on Mirwal with confidence.', icon: 'fa-solid fa-lightbulb', count: 12, accent: 'orange' },
  { title: 'Products', description: 'Add, manage, and optimize your products.', icon: 'fa-solid fa-box-open', count: 24, accent: 'blue' },
  { title: 'Orders & Shipments', description: 'Manage orders and deliver to customers.', icon: 'fa-solid fa-truck', count: 18, accent: 'green' },
  { title: 'Payments & Payouts', description: 'Understand payouts, fees, and withdrawals.', icon: 'fa-solid fa-wallet', count: 16, accent: 'mint' },
  { title: 'Returns & Refunds', description: 'Handle returns and refund requests.', icon: 'fa-solid fa-rotate-left', count: 12, accent: 'red' },
  { title: 'Store Management', description: 'Customize and manage your store.', icon: 'fa-solid fa-store', count: 14, accent: 'orange' },
  { title: 'Marketing', description: 'Promote your products and grow sales.', icon: 'fa-solid fa-bullhorn', count: 20, accent: 'purple' },
  { title: 'Policies & Compliance', description: 'Review policies and seller requirements.', icon: 'fa-solid fa-file-lines', count: 10, accent: 'red' },
]

const articles = [
  { title: 'How do I create a shipment?', description: 'Step-by-step guide to create a shipment for an order.', path: '/seller/help/articles/create-shipment' },
  { title: 'How can I update the order status?', description: 'Learn how to change the status of an order.', path: '/seller/help/articles/update-order-status' },
  { title: 'How do customers track their orders?', description: 'Learn how customers can track their orders.', path: '/seller/help/articles/track-orders' },
  { title: 'How do I handle a delayed order?', description: 'What to do when an order is delayed.', path: '/seller/help/articles/delayed-order' },
  { title: 'How do I print an invoice?', description: 'Learn how to print and download invoices.', path: '/seller/help/articles/print-invoice' },
  { title: 'How do I cancel an order?', description: 'Conditions and steps to cancel an order.', path: '/seller/help/articles/cancel-order' },
  { title: 'What if I shipped the wrong product?', description: 'Learn how to resolve incorrect shipments.', path: '/seller/help/articles/wrong-product' },
]

const guides = [
  { title: 'How to add a new product', description: 'Complete guide to add simple and variable products.', icon: 'fa-solid fa-box-open', path: '/seller/help/guides/add-product' },
  { title: 'How to set up shipping methods', description: 'Configure shipping methods and delivery options.', icon: 'fa-solid fa-truck', path: '/seller/help/guides/shipping-methods' },
  { title: 'How to connect a payment account', description: 'Set up your payout account and payment details.', icon: 'fa-solid fa-wallet', path: '/seller/help/guides/payment-account' },
  { title: 'How to manage your refunds', description: 'Handle return requests and issue refunds.', icon: 'fa-solid fa-rotate-left', path: '/seller/help/guides/refunds' },
  { title: 'How to customize your store', description: 'Personalize your store and create a great experience.', icon: 'fa-solid fa-store', path: '/seller/help/guides/customize-store' },
]

const videos = ['How to add a new product', 'How to create a shipment', 'How to update order status', 'How to manage returns', 'How to connect payment', 'How to set up shipping methods', 'How to create a discount', 'How to run an ad campaign']

function SearchBox({ value, onChange, onSubmit, placeholder }) {
  return <form className="seller-help-search-wrap" onSubmit={onSubmit}><div className="seller-search-box seller-help-search"><span className="seller-search-icon"><i className="fa-solid fa-magnifying-glass" /></span><input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} aria-label="Search Help Center" /></div><button type="submit" className="seller-primary-btn">Search</button></form>
}

function HelpCard({ item, onClick }) {
  return <button type="button" className="seller-help-category-card" onClick={onClick}><span className={`seller-help-category-icon ${item.accent}`}><i className={item.icon} /></span><span className="seller-help-card-copy"><strong>{item.title}</strong><small>{item.description}</small><em>{item.count} articles</em></span><i className="fa-solid fa-chevron-right seller-help-card-arrow" /></button>
}

function SellerHelpCenter({ view = 'overview' }) {
  const [query, setQuery] = useState('')
  const [submittedQuery, setSubmittedQuery] = useState('')
  const openPage = (path) => navigateTo(path)
  const filteredArticles = useMemo(() => articles.filter((item) => `${item.title} ${item.description}`.toLowerCase().includes(submittedQuery.toLowerCase())), [submittedQuery])
  const breadcrumbs = [{ label: 'Dashboard', onClick: () => navigateTo('/seller') }, { label: 'Help Center' }]
  const topicPath = (title) => title === 'Orders & Shipments' ? '/seller/help/categories/orders-shipments' : '/seller/help/categories'

  const renderOverview = () => <><div className="seller-help-hero"><div><h1>Help Center</h1><p>Find answers, learn about Mirwal Seller Center and grow your business.</p></div><div className="seller-help-hero-art"><i className="fa-solid fa-lightbulb" /></div></div><SearchBox value={query} onChange={setQuery} onSubmit={(event) => { event.preventDefault(); setSubmittedQuery(query) }} placeholder="Search for articles, tutorials or topics..." /><div className="seller-help-popular"><strong>Popular searches:</strong>{['Add product', 'Create shipment', 'Payment pending', 'Returns & refunds', 'Store settings'].map((item) => <button type="button" key={item} onClick={() => { setQuery(item); setSubmittedQuery(item) }}>{item}</button>)}</div><section className="seller-help-section"><div className="seller-help-section-title"><h2>Browse by Category</h2><button type="button" onClick={() => openPage('/seller/help/categories')}>View all <i className="fa-solid fa-arrow-right" /></button></div><div className="seller-help-category-grid">{categories.map((item) => <HelpCard key={item.title} item={item} onClick={() => openPage(topicPath(item.title))} />)}</div></section><section className="seller-help-section"><div className="seller-help-section-title"><h2>Featured</h2></div><div className="seller-help-feature-grid"><button type="button" className="seller-help-feature-card" onClick={() => openPage('/seller/help/faqs')}><i className="fa-solid fa-circle-question" /><span><strong>FAQs</strong><small>Find quick answers to common questions.</small></span><b>View FAQs</b></button><button type="button" className="seller-help-feature-card green" onClick={() => openPage('/seller/help/guides')}><i className="fa-solid fa-book-open" /><span><strong>How-to Guides</strong><small>Step-by-step guides to help you use all features.</small></span><b>View Guides</b></button><button type="button" className="seller-help-feature-card purple" onClick={() => openPage('/seller/help/videos')}><i className="fa-solid fa-circle-play" /><span><strong>Video Tutorials</strong><small>Watch and learn with our video tutorials.</small></span><b>Watch Videos</b></button></div></section><button type="button" className="seller-help-start-banner" onClick={() => openPage('/seller/help/guides')}><span><strong>New to Mirwal Seller Center?</strong><small>Follow our getting started guide and set up your store the right way.</small><b>View Getting Started Guide <i className="fa-solid fa-arrow-right" /></b></span><i className="fa-solid fa-rocket" /></button></>

  const renderCategories = () => <section className="seller-help-section seller-help-page-card"><div className="seller-help-section-title"><div><span className="seller-help-kicker">Help Center /</span><h1>All Categories</h1><p>Choose a category to find the information you need.</p></div></div><div className="seller-help-category-grid large">{categories.map((item) => <HelpCard key={item.title} item={item} onClick={() => openPage(topicPath(item.title))} />)}</div></section>

  const renderOrders = () => <section className="seller-help-section seller-help-page-card"><div className="seller-help-section-title"><div><span className="seller-help-kicker">Help Center / Categories /</span><h1>Orders & Shipments</h1><p>Learn how to manage orders, create shipments, and track deliveries.</p></div></div><SearchBox value={query} onChange={setQuery} onSubmit={(event) => { event.preventDefault(); setSubmittedQuery(query) }} placeholder="Search in Orders & Shipments..." /><div className="seller-help-article-list">{filteredArticles.map((item) => <button type="button" key={item.title} className="seller-help-article-row" onClick={() => openPage(item.path)}><i className="fa-regular fa-file-lines" /><span><strong>{item.title}</strong><small>{item.description}</small></span><i className="fa-solid fa-chevron-right" /></button>)}</div><small className="seller-help-result-count">Showing {filteredArticles.length} of {articles.length} articles</small></section>

  const renderVideos = () => <section className="seller-help-section seller-help-page-card"><div className="seller-help-section-title"><div><span className="seller-help-kicker">Help Center /</span><h1>Video Tutorials</h1><p>Watch step-by-step videos and learn visually.</p></div></div><SearchBox value={query} onChange={setQuery} onSubmit={(event) => event.preventDefault()} placeholder="Search videos..." /><div className="seller-help-video-grid">{videos.map((title, index) => <button type="button" key={title} className="seller-help-video-card" onClick={() => openPage('/seller/help/videos')}><span className="seller-help-video-thumb"><i className="fa-solid fa-play" /><em>0{4 + (index % 5)}:{String(35 + index * 5).padStart(2, '0')}</em></span><strong>{title}</strong></button>)}</div><button type="button" className="seller-help-outline-btn">View all videos</button></section>

  const renderGuides = () => <section className="seller-help-section seller-help-page-card"><div className="seller-help-section-title"><div><span className="seller-help-kicker">Help Center /</span><h1>How-to Guides</h1><p>Step-by-step guides to help you use all features.</p></div></div><div className="seller-help-guide-list">{guides.map((guide) => <button type="button" key={guide.title} className="seller-help-guide-row" onClick={() => openPage(guide.path)}><span className="seller-help-guide-icon"><i className={guide.icon} /></span><span><strong>{guide.title}</strong><small>{guide.description}</small><em>Updated 5 days ago <b>•</b> 6 min read</em></span><i className="fa-solid fa-chevron-right" /></button>)}</div></section>

  const renderDetail = () => <section className="seller-help-section seller-help-page-card seller-help-detail"><div className="seller-help-section-title"><div><span className="seller-help-kicker">Help Center / How-to Guides /</span><h1>How to add a new product</h1><p>Learn how to add simple, variable and digital products to your store.</p></div><button type="button" className="seller-help-print" onClick={() => window.print()}><i className="fa-solid fa-print" /> Print</button></div><div className="seller-help-detail-layout"><aside><strong>In this guide</strong>{['Introduction', 'Go to Products', 'Click Add New Product', 'Fill Product Details', 'Product Images', 'Pricing & Inventory', 'Save Product'].map((step, index) => <button type="button" className={index === 0 ? 'active' : ''} key={step}>{index + 1}. {step}</button>)}</aside><article><h3>1. Introduction</h3><p>Adding products to your store helps customers find and buy from you. Follow these steps to add a new product in the Mirwal Seller Center.</p><h3>2. Go to Products</h3><p>From the Seller Center menu, go to Products and click on All Products.</p><div className="seller-help-mock-screen"><span><i className="fa-solid fa-box-open" /> Products</span><b><i className="fa-solid fa-plus" /> Add New Product</b><span>Categories</span><span>Brands</span></div><h3>3. Click Add New Product</h3><p>Click the Add New Product button on the top right to open the product form.</p></article></div></section>

  let content = view === 'categories' ? renderCategories() : view === 'orders' ? renderOrders() : view === 'videos' ? renderVideos() : view === 'guides' ? renderGuides() : view === 'guide-detail' || view === 'article' ? renderDetail() : renderOverview()
  return <SellerLayout activeItem="support-page" breadcrumbs={breadcrumbs}><div className="seller-help-page">{content}</div></SellerLayout>
}

export default SellerHelpCenter
