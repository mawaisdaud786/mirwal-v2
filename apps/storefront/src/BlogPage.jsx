import { useState } from 'react'
import Header from './components/Header'
import Footer from './components/Footer'
import blogBanner from './assets/images/blog banner.png'
import './blog.css'

const FaIcon = ({ name }) => <i className={`fa-solid fa-${name}`} aria-hidden="true" />
const articles = [
  ['Shopping Guide', '10 Smart Shopping Tips to Save Money Online', 'Learn how to find the best deals, use coupons wisely and get more value for your money.', 'May 18, 2025', '5 min read', 'https://images.unsplash.com/photo-1586880244406-556ebe35f282?w=700&q=85'],
  ['Tech & Gadgets', 'Top 7 Gadgets You Should Buy in 2025', 'Explore the most useful and trending gadgets that make life easier and more fun.', 'May 15, 2025', '6 min read', 'https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?w=700&q=85'],
  ['Home & Lifestyle', 'Easy Ways to Upgrade Your Home on a Budget', 'Simple and affordable ideas to make your home look better and more comfortable.', 'May 12, 2025', '4 min read', 'https://images.unsplash.com/photo-1616486338812-3dadae4b4ace?w=700&q=85'],
]
const popularPosts = [['How to Find the Best Deals Online in Pakistan', 'May 20, 2025', articles[0][5]], ['Best Budget Headphones Under PKR 10,000', 'May 17, 2025', 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=240&q=80'], ['Mobile Buying Guide: What to Check Before You Buy', 'May 10, 2025', articles[1][5]]]

function ArticleCard({ article }) { return <article className="blog-article"><img src={article[5]} alt="" /><div><small>{article[0]}</small><h2>{article[1]}</h2><p>{article[2]}</p><footer><span><FaIcon name="calendar-days" /> {article[3]}</span><span><FaIcon name="clock" /> {article[4]}</span></footer></div></article> }

export default function BlogPage({ cartCount }) {
  const [query, setQuery] = useState('')
  const [submittedQuery, setSubmittedQuery] = useState('')
  const submitSearch = (event) => { event.preventDefault(); setSubmittedQuery(query.trim()) }
  const visibleArticles = submittedQuery ? articles.filter((article) => article.join(' ').toLowerCase().includes(submittedQuery.toLowerCase())) : articles
  return <><Header cartCount={cartCount} /><main className="blog-page container"><section className="blog-hero"><img src={blogBanner} alt="MIRWAL blog" /></section><div className="blog-layout"><div className="blog-main"><div className="blog-section-heading"><h1>Latest Articles</h1>{submittedQuery && <button type="button" onClick={() => { setQuery(''); setSubmittedQuery('') }}>Clear search</button>}</div>{visibleArticles.length ? <div className="blog-article-grid">{visibleArticles.map((article) => <ArticleCard key={article[1]} article={article} />)}</div> : <div className="blog-empty"><h2>No articles found</h2><p>Try a different search term.</p></div>}<nav className="blog-pagination" aria-label="Blog pages"><button type="button" aria-label="Previous page"><FaIcon name="chevron-left" /></button><button className="active" type="button">1</button><button type="button">2</button><button type="button">3</button><button type="button">...</button><button type="button">8</button><button type="button" aria-label="Next page"><FaIcon name="chevron-right" /></button></nav></div><aside className="blog-sidebar"><section className="blog-side-card"><h2>Search Blog</h2><form onSubmit={submitSearch}><label><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search articles..." aria-label="Search articles" /><button type="submit" aria-label="Search blog"><FaIcon name="magnifying-glass" /></button></label></form></section><section className="blog-side-card"><h2>Categories</h2>{[['Shopping Guide', '12', 'bag-shopping'], ['Tech & Gadgets', '10', 'mobile-screen-button'], ['Home & Lifestyle', '8', 'house'], ['Trends & News', '6', 'wand-magic-sparkles'], ['Deals & Offers', '7', 'tag']].map(([label, count, icon]) => <button className="blog-category" type="button" key={label} onClick={() => { setQuery(label); setSubmittedQuery(label) }}><span><FaIcon name={icon} /> {label}</span><b>{count}</b></button>)}<button className="blog-side-link" type="button">View all categories <FaIcon name="chevron-right" /></button></section><section className="blog-side-card"><h2>Popular Posts</h2>{popularPosts.map(([title, date, image]) => <button className="blog-popular" type="button" key={title}><img src={image} alt="" /><span>{title}<small>{date}</small></span></button>)}<button className="blog-side-link" type="button">View all posts <FaIcon name="chevron-right" /></button></section></aside></div></main><Footer /></>
}
