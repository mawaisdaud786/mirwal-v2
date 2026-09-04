import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import compareBanner from './assets/images/compare-banner.webp'
import mirwalLogo from './assets/brand/mirwal-symbol-logo.png'
import './compare.css'
import { navigateTo } from '@mirwal/shared/navigation'
import { useComparison } from './components/useComparison'
import { useApiQuery } from '@mirwal/shared/useApiQuery'
import api from './api'

/**
 * Compare — the last page still driving the shared comparison context off mock data.
 *
 * ExplorePage, CategoriesPage and SearchResultsPage all link here as `/compare?product=slug`
 * rather than calling `addProduct` with a live API product, specifically because this page
 * used to render `product.price` as a bare string. The API's `product.price` is
 * `{amount, currency, display}`, which React cannot render as a child — that shape mismatch
 * is what this conversion resolves, so the other pages' compare links now resolve to a real
 * product instead of nothing.
 *
 * Also removed:
 *   - This page rendered its own <Header>/<Footer> while mounted under PublicLayout, which
 *     already renders both `global` — the same duplicate-chrome bug fixed in
 *     SearchResultsPage.
 *   - `compareImages`, a hand-picked Unsplash URL for four specific mock products whose own
 *     images did not load. Real products carry real images.
 *   - `Brand` and `Availability` in the feature table were guessed from the product name
 *     (`name.split(' ')[0]`) and a fixed "Check product page" placeholder. Both are real
 *     fields on the API product now.
 */

function navigate(path) { navigateTo(path) }

const FaIcon = ({ name }) => <i className={`fa-solid fa-${name}`} aria-hidden="true" />

const featureNames = ['Price', 'Rating', 'Brand', 'Type', 'Availability', 'Seller']

function loadComparisonImage(url) {
  return new Promise((resolve) => {
    if (!url) { resolve(null); return }
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => resolve(image)
    image.onerror = () => resolve(null)
    image.src = url
  })
}

function drawWrappedText(context, text, x, y, maxWidth, lineHeight, maxLines = 3) {
  const words = String(text ?? '').split(/\s+/).filter(Boolean)
  const lines = []
  let line = ''
  words.forEach((word) => {
    const candidate = line ? `${line} ${word}` : word
    if (line && context.measureText(candidate).width > maxWidth) {
      lines.push(line)
      line = word
    } else {
      line = candidate
    }
  })
  if (line) lines.push(line)
  const visibleLines = lines.slice(0, maxLines)
  if (lines.length > maxLines) {
    let lastLine = visibleLines[maxLines - 1]
    while (lastLine.length > 3 && context.measureText(`${lastLine}...`).width > maxWidth) lastLine = lastLine.slice(0, -1)
    visibleLines[maxLines - 1] = `${lastLine.trim()}...`
  }
  visibleLines.forEach((lineText, index) => context.fillText(lineText, x, y + index * lineHeight))
  return visibleLines.length
}

async function createComparisonImage(products) {
  const canvas = document.createElement('canvas')
  canvas.width = 1200
  canvas.height = 1250
  const context = canvas.getContext('2d')
  if (!context) return null

  context.fillStyle = '#fff8f3'
  context.fillRect(0, 0, canvas.width, canvas.height)
  const logo = await loadComparisonImage(mirwalLogo)
  if (logo) {
    context.drawImage(logo, 60, 32, 76, 76)
    context.save()
    context.globalAlpha = 0.055
    context.drawImage(logo, canvas.width - 450, 300, 360, 360)
    context.restore()
  }
  context.fillStyle = '#1f1713'
  context.font = '700 44px Manrope, sans-serif'
  context.fillText('Mirwal product comparison', 165, 70)
  context.fillStyle = '#75645b'
  context.font = '20px DMSans, sans-serif'
  context.fillText('Compare the details. Choose with confidence.', 165, 101)
  context.fillStyle = '#e86f2d'
  context.fillRect(165, 122, 100, 8)

  const cardWidth = 250
  const cardHeight = 530
  const cardGap = 24
  const startX = (canvas.width - (products.length * cardWidth + (products.length - 1) * cardGap)) / 2
  const images = await Promise.all(products.map((product) => loadComparisonImage(product.images?.[0]?.url)))
  products.forEach((product, index) => {
    const x = startX + index * (cardWidth + cardGap)
    const y = 160
    const padding = 24
    context.fillStyle = '#ffffff'
    context.fillRect(x, y, cardWidth, cardHeight)
    context.strokeStyle = '#eadbd2'
    context.strokeRect(x, y, cardWidth, cardHeight)
    const image = images[index]
    if (image) {
      const imageSize = 210
      const scale = Math.min(imageSize / image.width, imageSize / image.height)
      const imageWidth = image.width * scale
      const imageHeight = image.height * scale
      context.drawImage(image, x + (cardWidth - imageWidth) / 2, y + 24 + (imageSize - imageHeight) / 2, imageWidth, imageHeight)
    }
    context.fillStyle = '#1f1713'
    context.font = '700 22px Manrope, sans-serif'
    const nameLines = drawWrappedText(context, product.name, x + padding, y + 282, cardWidth - padding * 2, 28, 3)
    const detailY = y + 282 + nameLines * 28 + 12
    context.fillStyle = '#75645b'
    context.font = '18px DMSans, sans-serif'
    drawWrappedText(context, product.subtitle ?? '', x + padding, detailY, cardWidth - padding * 2, 24, 2)
    context.fillStyle = '#e86f2d'
    context.font = '700 25px DMSans, sans-serif'
    context.fillText(product.price.display, x + padding, detailY + 56)
    context.fillStyle = '#75645b'
    context.font = '18px DMSans, sans-serif'
    context.fillText(product.rating.count > 0 ? `Rating ${product.rating.average.toFixed(1)}` : 'No reviews yet', x + padding, detailY + 98)
    context.fillText(product.availability.inStock ? 'In stock' : 'Out of stock', x + padding, detailY + 136)
  })

  const tableX = 60
  const tableY = 750
  const labelWidth = 190
  const columnWidth = (canvas.width - tableX * 2 - labelWidth) / products.length
  const rows = [
    ['Price', (product) => product.price.display],
    ['Rating', (product) => product.rating.count > 0 ? `${product.rating.average.toFixed(1)} (${product.rating.count})` : 'No reviews yet'],
    ['Brand', (product) => product.brand?.name ?? 'Unbranded'],
    ['Type', (product) => product.subtitle ?? 'Not specified'],
    ['Availability', (product) => product.availability.inStock ? (product.availability.lowStock ? 'Low stock' : 'In stock') : 'Out of stock'],
    ['Seller', (product) => product.seller?.name ?? 'Marketplace seller'],
  ]
  const headerHeight = 76
  const rowHeight = 58
  const tableHeight = headerHeight + rows.length * rowHeight
  context.fillStyle = '#1f1713'
  context.font = '700 28px Manrope, sans-serif'
  context.fillText('Side-by-side details', tableX, tableY - 22)
  context.fillStyle = '#ffffff'
  context.fillRect(tableX, tableY, canvas.width - tableX * 2, tableHeight)
  context.strokeStyle = '#eadbd2'
  context.strokeRect(tableX, tableY, canvas.width - tableX * 2, tableHeight)
  context.fillStyle = '#fff0e7'
  context.fillRect(tableX, tableY, canvas.width - tableX * 2, headerHeight)
  context.fillStyle = '#1f1713'
  context.font = '700 18px DMSans, sans-serif'
  products.forEach((product, index) => drawWrappedText(context, product.name, tableX + labelWidth + index * columnWidth + 20, tableY + 27, columnWidth - 40, 22, 2))

  rows.forEach(([label, valueForProduct], rowIndex) => {
    const y = tableY + headerHeight + rowIndex * rowHeight
    if (rowIndex % 2 === 1) {
      context.fillStyle = '#fffaf7'
      context.fillRect(tableX, y, canvas.width - tableX * 2, rowHeight)
    }
    context.strokeStyle = '#eadbd2'
    context.beginPath()
    context.moveTo(tableX, y)
    context.lineTo(canvas.width - tableX, y)
    context.stroke()
    context.fillStyle = '#1f1713'
    context.font = '700 18px DMSans, sans-serif'
    context.fillText(label, tableX + 20, y + 35)
    products.forEach((product, productIndex) => {
      context.font = '18px DMSans, sans-serif'
      drawWrappedText(context, valueForProduct(product), tableX + labelWidth + productIndex * columnWidth + 20, y + 25, columnWidth - 40, 22, 2)
    })
  })

  context.beginPath()
  context.moveTo(tableX + labelWidth, tableY)
  context.lineTo(tableX + labelWidth, tableY + tableHeight)
  products.forEach((_, index) => {
    const x = tableX + labelWidth + (index + 1) * columnWidth
    context.moveTo(x, tableY)
    context.lineTo(x, tableY + tableHeight)
  })
  context.stroke()
  context.fillStyle = '#75645b'
  context.font = '700 20px DMSans, sans-serif'
  context.textAlign = 'center'
  context.fillText('© mirwal.pk', canvas.width / 2, 1210)
  context.textAlign = 'start'
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
}

function productDetails(product) {
  return {
    Price: product.price.display,
    Rating: product.rating.count > 0
      ? <span className="compare-table-rating"><FaIcon name="star" /> {product.rating.average.toFixed(1)} ({product.rating.count})</span>
      : 'No reviews yet',
    Brand: product.brand?.name ?? 'Unbranded',
    Type: product.subtitle,
    Availability: product.availability.inStock ? (product.availability.lowStock ? 'Low stock' : 'In stock') : 'Out of stock',
    Seller: product.seller?.name ?? 'Marketplace seller',
  }
}

function ProductCard({ product, onRemove, onAddToCart }) {
  const image = product.images[0]
  return <article className="compare-product-card">
    <button className="compare-remove" type="button" onClick={() => onRemove(product.id)} aria-label={`Remove ${product.name} from comparison`} title="Remove product"><FaIcon name="xmark" /></button>
    {product.discountPercent > 0 && <span className="compare-badge">−{product.discountPercent}%</span>}
    <img src={image?.url} alt={image?.alt ?? product.name} />
    <h3 title={product.name}>{product.name}</h3>
    <small>{product.subtitle}</small>
    <p className="compare-rating"><FaIcon name="star" /> {product.rating.count > 0 ? product.rating.average.toFixed(1) : 'No reviews'}</p>
    <strong>{product.price.display}</strong>
    {product.compareAtPrice && <del>{product.compareAtPrice.display}</del>}
    <button className="compare-cart" type="button" onClick={() => onAddToCart(product)}>Add to Cart</button>
  </article>
}

export default function ComparePage({ onAddToCart }) {
  const location = useLocation()
  const { products: selected, addProduct: addComparedProduct, removeProduct, clearProducts } = useComparison()
  const [search, setSearch] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const slugs = (params.get('products') || params.get('product') || '').split(',').map((value) => value.trim()).filter(Boolean)
    if (!slugs.length) return

    let active = true
    Promise.all(slugs.map((slug) => api.products.get(slug).catch(() => null)))
      .then((results) => { if (active) results.filter(Boolean).forEach((product) => addComparedProduct(product)) })
    return () => { active = false }
  }, [addComparedProduct, location.search])

  const { data: searchData } = useApiQuery(
    (signal) => api.products.list({ q: search || undefined, pageSize: 8 }, signal),
    [search],
  )
  const available = (searchData?.items ?? [])
    .filter((product) => !selected.some((item) => item.id === product.id))
    .slice(0, 5)

  const addProduct = (slug) => {
    const product = available.find((item) => item.slug === slug)
    if (!product) return
    if (selected.length < 4) addComparedProduct(product)
    else setNotice('Remove a product before adding another')
  }
  const shareComparison = async () => {
    if (selected.length === 0) {
      setNotice('Add products before sharing the comparison')
      return
    }

    const comparisonUrl = new URL('/compare', window.location.origin)
    comparisonUrl.searchParams.set('products', selected.map((product) => product.slug).join(','))
    const text = `Mirwal comparison: ${selected.map((product) => product.name).join(', ')}`
    const comparisonImage = await createComparisonImage(selected)
    try {
      const shareFile = comparisonImage ? new File([comparisonImage], 'mirwal-comparison.png', { type: 'image/png' }) : null
      if (navigator.share && (!shareFile || !navigator.canShare || navigator.canShare({ files: [shareFile] }))) {
        await navigator.share({ title: 'Mirwal product comparison', text, url: comparisonUrl.href, ...(shareFile ? { files: [shareFile] } : {}) })
        setNotice('Comparison shared successfully')
      } else {
        await navigator.clipboard.writeText(comparisonUrl.href)
        setNotice('Comparison link copied to clipboard')
      }
    } catch (error) {
      if (error.name === 'AbortError') return
      try {
        await navigator.clipboard.writeText(comparisonUrl.href)
        setNotice('Comparison link copied to clipboard')
      } catch {
        setNotice('Unable to share this comparison')
      }
    }
    window.setTimeout(() => setNotice(''), 2200)
  }

  useEffect(() => { document.title = selected.length ? `Compare ${selected.map((product) => product.name).join(' vs ')} | Mirwal` : 'Compare products | Mirwal'; let meta = document.querySelector('meta[name="description"]'); if (!meta) { meta = document.createElement('meta'); meta.name = 'description'; document.head.appendChild(meta) }; meta.setAttribute('content', 'Compare products, prices, ratings and available details side by side on Mirwal.') }, [selected])
  return <main className="compare-page">
    <section className="compare-hero"><div className="container compare-hero-inner"><div><div className="compare-breadcrumb"><button type="button" onClick={() => navigate('/')}>Home</button><span>›</span>Compare</div><h1>Compare <span>products</span></h1><p>Compare features, prices and reviews to find<br />the best product for your needs.</p><div className="compare-points"><span><FaIcon name="layer-group" /><b>Compare up to 4 products</b><small>Add products to compare</small></span><span><FaIcon name="magnifying-glass-chart" /><b>See key differences</b><small>Side-by-side comparison</small></span><span><FaIcon name="award" /><b>Choose the best</b><small>Pick what’s right for you</small></span></div></div><div className="compare-art"><img src={compareBanner} alt="Mirwal product comparison banner" /></div></div></section>
    <section className="comparison-section container"><div className="comparison-toolbar"><div><h2>Your comparison <span>{selected.length} / 4 products added</span></h2><p>{selected.length ? 'Review products side by side to make a confident choice.' : 'Add products below to start comparing.'}</p></div><div><button className="compare-clear" type="button" onClick={clearProducts}>Clear all</button><button className="compare-share" type="button" onClick={shareComparison}><FaIcon name="share-nodes" /> Share comparison</button></div></div>
      <div className="comparison-layout"><aside className="compare-sidebar"><button className="sidebar-close" type="button" aria-label="Close product picker"></button><h3>Add products to<br />compare</h3><p>Search and select products you want to compare.</p><label className="compare-search"><span></span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search products..." aria-label="Search products to compare" /></label><div className="available-products">{available.map((product) => <button type="button" key={product.id} onClick={() => addProduct(product.slug)}><img src={product.images[0]?.url} alt="" /><span><b>{product.name}</b><small>{product.subtitle}</small></span><em>Add</em></button>)}</div><button className="all-products" type="button" onClick={() => navigate('/explore')}>View all products</button></aside><div className="comparison-content">{selected.length === 0 ? <section className="compare-empty-state"><span className="compare-empty-icon"><FaIcon name="robot" /></span><h2>Your comparison is waiting to take shape</h2><p>Not sure what belongs here? Tell Mirwal AI what you need and discover products worth comparing.</p><button type="button" onClick={() => navigate('/ai-assistant')}><FaIcon name="wand-magic-sparkles" /> Explore with Mirwal AI</button></section> : <><div className={`compare-cards compare-cards-${selected.length}`}><div className="compare-card-spacer" aria-hidden="true" />{selected.map((product) => <ProductCard key={product.id} product={product} onRemove={removeProduct} onAddToCart={onAddToCart} />)}</div><div className="feature-table-wrap"><table className="feature-table"><thead><tr><th scope="col">Features</th>{selected.map((product) => <th scope="col" key={product.id}>{product.name}</th>)}</tr></thead><tbody>{featureNames.map((feature) => <tr key={feature}><th scope="row">{feature}</th>{selected.map((product) => <td key={product.id}>{feature === 'Price' ? <b>{productDetails(product)[feature]}</b> : productDetails(product)[feature]}</td>)}</tr>)}<tr><th scope="row">Add to Cart</th>{selected.map((product) => <td key={product.id}><button className="table-cart" type="button" onClick={() => onAddToCart(product)}>Add to cart</button></td>)}</tr></tbody></table></div></>}</div></div>
    </section>
    <section className="compare-benefits container"><div><span><FaIcon name="shield-halved" /></span><b>100% Secure Payments</b><small>Safe & encrypted</small></div><div><span><FaIcon name="rotate-left" /></span><b>Easy Returns</b><small>Hassle-free returns</small></div><div><span><FaIcon name="truck-fast" /></span><b>Fast Delivery</b><small>Across Pakistan</small></div><div><span><FaIcon name="headset" /></span><b>24/7 Support</b><small>We're here for you</small></div></section>
    <section className="compare-newsletter container"><div><h2>Stay updated with the best products &amp; deals</h2><p>Subscribe to our newsletter and never miss an update.</p></div><form onSubmit={(event) => { event.preventDefault(); setNotice('Thanks for subscribing to Mirwal') }}><input type="email" required placeholder="Enter your email address" aria-label="Email address" /><button type="submit">Subscribe</button></form><span className="newsletter-art" aria-hidden="true"><FaIcon name="envelope-open-text" /></span></section>
    {notice && <div className="compare-notice" role="status">{notice}</div>}
  </main>
}
