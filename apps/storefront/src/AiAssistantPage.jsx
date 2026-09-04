import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import './ai-assistant.css'
import { navigateTo } from '@mirwal/shared/navigation'
import api from './api'
import { describeApiError, useApiQuery } from '@mirwal/shared/useApiQuery'
import { useComparison } from './components/useComparison'

/**
 * Mirwal AI shopping assistant.
 *
 * This page calls POST /ai/ask, which grounds every answer in the real catalogue
 * (server/src/modules/ai/ai.service.js). The assistant cannot name a product, price, rating,
 * seller or stock level that is not a live database row, so the product cards below render
 * the same records the search matched — clicking one opens that exact product, comparing one
 * adds that exact record to the real comparison tray, and adding to cart adds that exact row.
 *
 * Every answer's products render inside that answer's own chat bubble, in the scrolling
 * transcript above the pinned input — never in a separate side panel. A separate panel was
 * tried and dropped: on narrow screens it landed below the input, which is the one place a
 * chat UI must never put content the user is trying to read.
 *
 * Two things were deliberately left out despite being in the design reference this was built
 * from: a wishlist heart on each card (there is no wishlist API in this backend yet — a heart
 * that does not persist anything would be exactly the kind of fake control the project's
 * anti-fabrication rule forbids) and mic/attach icons on the input (no speech-to-text or file
 * upload exists either). Both can be added for real once that backend support exists.
 */

const FaIcon = ({ name }) => <i className={`fa-solid fa-${name}`} aria-hidden="true" />

const SUGGESTED_PROMPTS = [
  'Power bank under 8,000',
  'Best rated kitchen tools',
  'Cheapest phone mount',
  'Discounted home organizers',
  'Something for my desk under 2,000',
  'Travel accessories',
]

const HOW_IT_WORKS = [
  ['comment-dots', 'Tell us your need', 'In your own words'],
  ['brain', 'AI understands', 'We match it to real products'],
  ['scale-balanced', 'Compare & choose', 'Compare products side by side'],
  ['shield-halved', 'Buy with confidence', 'From verified Mirwal sellers'],
]

const WHY_SHOP = [
  ['wand-magic-sparkles', 'Smart Recommendations', 'AI finds what matches your needs'],
  ['store', 'Real Products, Real Sellers', 'Every listing is a live Mirwal seller'],
  ['tags', 'Real Prices', 'The price shown is the price in the database'],
  ['circle-check', '100% Verified Listings', 'No invented products or reviews'],
]

/** Cosmetic only — matched by keyword against the real category name, so an unmapped or
 * renamed category still renders (with a generic icon) instead of breaking. */
function categoryIcon(name = '') {
  const lower = name.toLowerCase()
  if (lower.includes('mobile') || lower.includes('tech')) return 'mobile-screen-button'
  if (lower.includes('clean') || lower.includes('organiz')) return 'broom'
  if (lower.includes('kitchen') || lower.includes('appliance')) return 'blender'
  if (lower.includes('personal care') || lower.includes('groom')) return 'pump-soap'
  if (lower.includes('fashion') || lower.includes('wear')) return 'shirt'
  if (lower.includes('home') || lower.includes('comfort') || lower.includes('living')) return 'couch'
  if (lower.includes('fitness') || lower.includes('outdoor')) return 'person-running'
  if (lower.includes('car') || lower.includes('motorcycle')) return 'car-side'
  if (lower.includes('baby') || lower.includes('family')) return 'baby'
  if (lower.includes('pet')) return 'paw'
  if (lower.includes('station') || lower.includes('study') || lower.includes('office')) return 'pen'
  if (lower.includes('travel') || lower.includes('safety') || lower.includes('utility')) return 'plane'
  return 'grid-2'
}

/** A reason is a caveat (over budget, out of stock, low stock) or a genuine plus — these are
 * styled differently so a caveat never reads as an endorsement. */
function reasonTone(reason) {
  if (/over your budget|out of stock|low stock/.test(reason)) return 'caution'
  return 'positive'
}

function navigate(path) { navigateTo(path) }

function MirwalMascot() {
  return <div className="assistant-mascot" aria-hidden="true">
    <span className="assistant-mascot-badge assistant-mascot-badge-1"><FaIcon name="bag-shopping" /></span>
    <span className="assistant-mascot-badge assistant-mascot-badge-2"><FaIcon name="star" /></span>
    <span className="assistant-mascot-core"><FaIcon name="robot" /></span>
  </div>
}

function Sidebar({ sessions, activeSession, onNewChat, onSelectSession }) {
  const items = [['house', 'Home', '/'], ['grip', 'Explore', '/explore'], ['tag', 'Deals', '/deals'], ['crown', 'Brands', '/brands'], ['scale-balanced', 'Compare', '/compare'], ['truck-fast', 'Track Order', '/track-orders']]
  const helpItems = [['circle-question', 'Help Center', '/help-center'], ['store', 'Become a Seller', '/sell-with-mirwal']]

  const scrollToHowItWorks = () => document.getElementById('assistant-how-it-works')?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  return <aside className="assistant-sidebar">
    <button className="assistant-new-chat" type="button" onClick={onNewChat}><FaIcon name="plus" /> New Chat</button>
    <nav className="assistant-menu" aria-label="Shop navigation">{items.map(([icon, label, path]) => <button type="button" key={label} onClick={() => navigate(path)}><FaIcon name={icon} /> {label}</button>)}</nav>
    <nav className="assistant-menu assistant-menu-secondary" aria-label="Support">{helpItems.map(([icon, label, path]) => <button type="button" key={label} onClick={() => navigate(path)}><FaIcon name={icon} /> {label}</button>)}</nav>
    {sessions.length > 0 && <div className="assistant-recent"><div className="assistant-recent-heading"><b>This session</b><button type="button" onClick={onNewChat}>Clear</button></div>{sessions.map((chat) => <button type="button" className={chat === activeSession ? 'selected' : ''} key={chat} onClick={() => onSelectSession(chat)}><FaIcon name="message" /> {chat}</button>)}</div>}
    <section className="assistant-about">
      <div className="assistant-bot"><FaIcon name="robot" /></div>
      <h2>AI Shopping <span>✦</span></h2>
      <p>Smarter. Faster. Better.<br />Let Mirwal find and compare the best options for you.</p>
      <button type="button" onClick={scrollToHowItWorks}>See how it works <FaIcon name="arrow-right" /></button>
    </section>
  </aside>
}

/** A real product from the catalogue. Every field shown is that row's own data. */
function ProductCard({ product, onAddToCart, isCompared, onToggleCompare }) {
  const image = product.images?.[0]
  const outOfStock = !product.availability.inStock
  const availabilityLabel = outOfStock ? 'Out of stock' : product.availability.lowStock ? 'Low stock' : 'In stock'
  const availabilityClass = outOfStock ? 'is-out' : product.availability.lowStock ? 'is-low' : 'is-in'

  return <article className="assistant-product">
    <div className="assistant-product-media">
      <label className="assistant-compare-check" title={isCompared ? 'Remove from comparison' : 'Add to comparison'}>
        <input type="checkbox" checked={isCompared} onChange={() => onToggleCompare(product)} aria-label={isCompared ? `Remove ${product.name} from comparison` : `Add ${product.name} to comparison`} />
        <span><FaIcon name="check" /></span>
      </label>
      <button type="button" className="assistant-product-image-btn" onClick={() => navigate(`/product/${product.slug}`)} aria-label={`View ${product.name}`}>
        {image?.url && <img src={image.url} alt={image.alt ?? product.name} loading="lazy" />}
      </button>
      {product.discountPercent > 0 && <span className="assistant-product-badge">−{product.discountPercent}%</span>}
    </div>
    <div className="assistant-product-body">
      <button type="button" className="assistant-product-name" onClick={() => navigate(`/product/${product.slug}`)}>
        <b>{product.name}</b>
        <small>{product.subtitle}</small>
      </button>
      <div className="assistant-product-price">
        <strong>{product.price.display}</strong>
        {product.compareAtPrice && <del>{product.compareAtPrice.display}</del>}
      </div>
      <div className="assistant-product-meta">
        <span className="assistant-product-seller"><FaIcon name="store" /> {product.seller?.name ?? 'Mirwal seller'}</span>
        <span className={`assistant-availability ${availabilityClass}`}><FaIcon name="circle" /> {availabilityLabel}</span>
      </div>
      {product.rating.count > 0 && <span className="assistant-product-rating"><FaIcon name="star" /> {product.rating.average.toFixed(1)} <em>({product.rating.count})</em></span>}
      {product.reasons?.length > 0 && <ul className="assistant-product-reasons">
        {product.reasons.map((reason) => <li key={reason} className={reasonTone(reason)}><FaIcon name={reasonTone(reason) === 'positive' ? 'circle-check' : 'circle-exclamation'} /> {reason}</li>)}
      </ul>}
      <div className="assistant-product-actions">
        <button type="button" className="assistant-view-details" onClick={() => navigate(`/product/${product.slug}`)}>View Details</button>
        <button type="button" className="assistant-add-cart" onClick={() => onAddToCart(product)} disabled={outOfStock} aria-label={outOfStock ? `${product.name} is out of stock` : `Add ${product.name} to cart`}>
          <FaIcon name="cart-plus" />
        </button>
      </div>
    </div>
  </article>
}

/** What the assistant understood, shown so a misread request is visible and correctable
 * rather than hidden behind confident-sounding prose. */
function UnderstoodChips({ understood }) {
  const chips = []
  understood.categories.forEach((category) => chips.push(`Category: ${category.name}`))
  understood.brands.forEach((brand) => chips.push(`Brand: ${brand.name}`))
  if (understood.minPrice != null && understood.maxPrice != null) chips.push(`Rs. ${understood.minPrice.toLocaleString('en-PK')} – ${understood.maxPrice.toLocaleString('en-PK')}`)
  else if (understood.maxPrice != null) chips.push(`Under Rs. ${understood.maxPrice.toLocaleString('en-PK')}`)
  else if (understood.minPrice != null) chips.push(`Over Rs. ${understood.minPrice.toLocaleString('en-PK')}`)
  understood.keywords.forEach((keyword) => chips.push(keyword))
  if (chips.length === 0) return null
  return <div className="assistant-understood"><span>Searched for:</span>{chips.map((chip) => <b key={chip}>{chip}</b>)}</div>
}

function QuickActions({ answer, onCompareFirstTwo, onSeeMore, onChangeBudget }) {
  if (!answer || answer.products.length === 0) return null
  const actions = []
  if (answer.products.length >= 2) actions.push(['scale-balanced', 'Compare first two', onCompareFirstTwo])
  if (answer.totalMatches > answer.products.length) actions.push(['grip', 'Show more options', onSeeMore])
  actions.push(['sliders', answer.understood.maxPrice != null ? 'Change budget' : 'Add a budget', onChangeBudget])
  return <div className="assistant-quick-actions">{actions.map(([icon, label, handler]) => <button type="button" key={label} onClick={handler}><FaIcon name={icon} /> {label}</button>)}</div>
}

/** One turn's real matches, shown inside that turn's own chat bubble. */
function BotMessage({ answer, onAddToCart, comparedIds, onToggleCompare, onCompareFirstTwo, onSeeMore, onChangeBudget }) {
  return <div className="assistant-bot-message">
    <span className="assistant-bot-avatar"><FaIcon name="robot" /></span>
    <div>
      <p>{answer.reply}</p>
      <UnderstoodChips understood={answer.understood} />
      {answer.products.length > 0 && <>
        <div className="assistant-results-heading"><h2><FaIcon name="wand-magic-sparkles" /> Top matches for you</h2></div>
        <div className="assistant-product-grid">
          {answer.products.map((product) => <ProductCard key={product.id} product={product} onAddToCart={onAddToCart} isCompared={comparedIds.has(product.id)} onToggleCompare={onToggleCompare} />)}
        </div>
      </>}
      {answer.question && <p className="assistant-followup"><FaIcon name="circle-question" /> {answer.question}</p>}
      <QuickActions answer={answer} onCompareFirstTwo={onCompareFirstTwo} onSeeMore={onSeeMore} onChangeBudget={onChangeBudget} />
    </div>
  </div>
}

export default function AiAssistantPage({ onAddToCart }) {
  const location = useLocation()
  const initialQuery = new URLSearchParams(location.search).get('query') ?? ''
  const [message, setMessage] = useState(initialQuery)
  const [sessions, setSessions] = useState([])
  const [activeSession, setActiveSession] = useState('')
  const [messages, setMessages] = useState([])
  const [isThinking, setIsThinking] = useState(false)
  const [compareNotice, setCompareNotice] = useState('')
  const endRef = useRef(null)
  const inputRef = useRef(null)

  const { products: compared, addProduct: addCompared, removeProduct: removeCompared } = useComparison()
  const comparedIds = new Set(compared.map((product) => product.id))

  const { data: facets } = useApiQuery((signal) => api.products.facets(signal), [])
  const categories = (facets?.categories ?? []).slice(0, 10)

  useEffect(() => {
    document.title = 'AI Shopping Assistant | Mirwal'
    let meta = document.querySelector('meta[name="description"]')
    if (!meta) { meta = document.createElement('meta'); meta.name = 'description'; document.head.appendChild(meta) }
    meta.setAttribute('content', 'Tell Mirwal what you need and its AI assistant finds and compares matching products from the real Mirwal catalogue.')
  }, [])

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [messages, isThinking])

  const send = async (text) => {
    const value = text.trim()
    if (!value || isThinking) return
    setMessages((items) => [...items, { role: 'user', text: value }])
    setSessions((items) => [value, ...items.filter((item) => item !== value)].slice(0, 6))
    setActiveSession(value)
    setMessage('')
    setIsThinking(true)
    try {
      const answer = await api.ai.ask(value)
      setMessages((items) => [...items, { role: 'bot', answer }])
    } catch (error) {
      // Surfaced as a real failure rather than a fabricated "sorry, try again" reply that
      // would be indistinguishable from a genuine no-results answer.
      setMessages((items) => [...items, { role: 'error', text: describeApiError(error), retry: value }])
    } finally {
      setIsThinking(false)
    }
  }

  const submitMessage = (event) => { event.preventDefault(); send(message) }
  const startNewChat = () => { setMessage(''); setMessages([]); setActiveSession(''); setSessions([]) }
  const selectSession = (session) => { setMessage(session); setActiveSession(session) }

  const toggleCompare = (product) => {
    if (comparedIds.has(product.id)) { removeCompared(product.id); return }
    if (compared.length >= 4) {
      setCompareNotice('Comparison is full (4/4) — remove one to add another.')
      window.setTimeout(() => setCompareNotice(''), 2400)
      return
    }
    addCompared(product)
  }

  const compareFirstTwo = (answer) => {
    answer.products.slice(0, 2).forEach((product) => { if (!comparedIds.has(product.id)) toggleCompare(product) })
  }
  const focusInputForBudget = () => inputRef.current?.focus()

  const addToCart = (product) => onAddToCart?.(product)

  const inputBar = <form className="assistant-input" onSubmit={submitMessage}>
    <span><FaIcon name="wand-magic-sparkles" /></span>
    <input ref={inputRef} value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Describe what you need — e.g. 'power bank under 3000'" aria-label="Ask Mirwal AI" disabled={isThinking} />
    <button type="submit" aria-label="Send message" disabled={isThinking || !message.trim()}><FaIcon name="paper-plane" /></button>
  </form>

  const compareBar = compared.length > 0 && <div className="assistant-compare-bar">
    <span><FaIcon name="scale-balanced" /> {compared.length} selected for comparison</span>
    <button type="button" onClick={() => navigate('/compare')}>Compare selected ({compared.length}) <FaIcon name="arrow-right" /></button>
  </div>

  return <div className="assistant-page"><div className="assistant-shell">
    <Sidebar sessions={sessions} activeSession={activeSession} onNewChat={startNewChat} onSelectSession={selectSession} />
    <main className="assistant-main">
      {messages.length === 0 ? <div className="assistant-empty-scroll">
        <header className="assistant-heading">
          <MirwalMascot />
          <span className="assistant-hero-badge"><FaIcon name="sparkles" /> Meet Mirwal AI Assistant</span>
          <h1>Tell <em>Mirwal</em> what you need</h1>
          <p>Mirwal finds and compares the right products for you — real prices, real stock, real Mirwal sellers.</p>
        </header>

        {compareBar}
        {inputBar}
        {compareNotice && <p className="assistant-compare-notice" role="status">{compareNotice}</p>}

        <div className="assistant-try">
          <b>Try asking</b>
          <div>{SUGGESTED_PROMPTS.map((prompt) => <button type="button" key={prompt} onClick={() => send(prompt)}>{prompt}</button>)}</div>
        </div>

        {categories.length > 0 && <div className="assistant-categories">
          <b>Or browse a category</b>
          <div>{categories.map((category) => <button type="button" key={category.slug} onClick={() => send(category.name)}><FaIcon name={categoryIcon(category.name)} /> {category.name}</button>)}</div>
        </div>}

        <div className="assistant-how" id="assistant-how-it-works">
          <b>How Mirwal AI Assistant works</b>
          <div>{HOW_IT_WORKS.map(([icon, title, copy], index) => <div key={title}><span>{index + 1}</span><div><i className={`fa-solid fa-${icon}`} aria-hidden="true" /><div><strong>{title}</strong><small>{copy}</small></div></div></div>)}</div>
        </div>

        <div className="assistant-why-band">
          <b>Why shop with Mirwal?</b>
          <div>{WHY_SHOP.map(([icon, title, copy]) => <div key={title}><span><FaIcon name={icon} /></span><strong>{title}</strong><small>{copy}</small></div>)}</div>
        </div>
      </div> : (
        <>
          <section className="assistant-live-chat" aria-live="polite">
            {messages.map((item, index) => {
              if (item.role === 'user') return <div className="assistant-user-message" key={index}><div>{item.text}</div></div>
              if (item.role === 'error') return <div className="assistant-bot-message" key={index}><span className="assistant-bot-avatar assistant-bot-avatar-error"><FaIcon name="triangle-exclamation" /></span><div className="assistant-error-box"><p>{item.text}</p><button type="button" onClick={() => send(item.retry)}><FaIcon name="rotate-right" /> Try again</button></div></div>
              return <BotMessage
                key={index}
                answer={item.answer}
                onAddToCart={addToCart}
                comparedIds={comparedIds}
                onToggleCompare={toggleCompare}
                onCompareFirstTwo={() => compareFirstTwo(item.answer)}
                onSeeMore={() => navigate('/explore')}
                onChangeBudget={focusInputForBudget}
              />
            })}
            {isThinking && <div className="assistant-bot-message"><span className="assistant-bot-avatar"><FaIcon name="robot" /></span><div><p className="assistant-thinking"><span className="assistant-typing-dots"><i /><i /><i /></span> Searching the Mirwal catalogue…</p></div></div>}
            <div ref={endRef} />
          </section>

          {compareBar}
          {inputBar}
          {compareNotice && <p className="assistant-compare-notice" role="status">{compareNotice}</p>}
        </>
      )}
      <small className="assistant-privacy"><FaIcon name="lock" /> Mirwal AI only suggests products from Mirwal's real catalogue — real prices, stock and ratings.</small>
    </main>
  </div>
  </div>
}
