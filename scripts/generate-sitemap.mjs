/**
 * Generates public/sitemap.xml and keeps the Sitemap: line in public/robots.txt in sync.
 *
 * Runs as part of `npm run build` (see the prebuild script). The URL set is derived from the
 * same data the app renders, so when the mock data in apps/storefront/src/data is replaced by a real API this
 * script changes source rather than shape — see docs/PROJECT_AUDIT.md section 10.
 *
 * Set the production origin with SITE_URL (or VITE_SITE_URL) in the environment / .env.
 */
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const root = path.resolve(import.meta.dirname, '..')
const origin = (process.env.SITE_URL || process.env.VITE_SITE_URL || 'https://mirwal.com').replace(/\/$/, '')

const slugify = (value) => value.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')

/** Static routes that routeMeta.js marks index,follow. */
const staticPaths = [
  ['/', 1.0, 'daily'],
  ['/products', 0.9, 'daily'],
  ['/explore', 0.9, 'daily'],
  ['/categories', 0.8, 'weekly'],
  ['/brands', 0.7, 'weekly'],
  ['/sellers', 0.7, 'weekly'],
  ['/deals', 0.8, 'daily'],
  ['/compare', 0.5, 'monthly'],
  ['/guides', 0.7, 'weekly'],
  ['/new-arrivals', 0.7, 'daily'],
  ['/featured', 0.7, 'daily'],
  ['/ai-shopping', 0.6, 'monthly'],
  ['/sell-with-mirwal', 0.6, 'monthly'],
  ['/about', 0.4, 'monthly'],
  ['/help-center', 0.4, 'monthly'],
  ['/contact', 0.4, 'monthly'],
  ['/faq', 0.4, 'monthly'],
  ['/terms', 0.3, 'yearly'],
  ['/privacy', 0.3, 'yearly'],
  ['/shipping', 0.3, 'yearly'],
  ['/returns', 0.3, 'yearly'],
]

const xmlEscape = (value) => value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]))

const urlEntry = (loc, priority, changefreq, lastmod) => [
  '  <url>',
  `    <loc>${xmlEscape(origin + loc)}</loc>`,
  lastmod ? `    <lastmod>${lastmod}</lastmod>` : null,
  `    <changefreq>${changefreq}</changefreq>`,
  `    <priority>${priority.toFixed(1)}</priority>`,
  '  </url>',
].filter(Boolean).join('\n')

async function run() {
  // Imported dynamically so this script stays usable once the data source changes.
  const dataUrl = pathToFileURL(path.join(root, 'apps/storefront/src/data/mockData.js')).href
  const { products, categories } = await import(dataUrl)

  const today = new Date().toISOString().slice(0, 10)
  const entries = [
    ...staticPaths.map(([loc, priority, changefreq]) => urlEntry(loc, priority, changefreq, today)),
    ...categories
      .filter(([name]) => name !== 'More Categories')
      .map(([name]) => urlEntry(`/categories/${slugify(name)}`, 0.8, 'weekly', today)),
    ...products.map((product) => urlEntry(`/product/${product.id}`, 0.7, 'weekly', today)),
  ]

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...entries,
    '</urlset>',
    '',
  ].join('\n')

  await writeFile(path.join(root, 'apps/storefront/public/sitemap.xml'), xml, 'utf8')

  const robotsPath = path.join(root, 'apps/storefront/public/robots.txt')
  const robots = await readFile(robotsPath, 'utf8')
  await writeFile(robotsPath, robots.replace(/^Sitemap: .*$/m, `Sitemap: ${origin}/sitemap.xml`), 'utf8')

  console.log(`  sitemap.xml: ${entries.length} URLs at ${origin}`)
}

run()
