/**
 * One-off / repeatable image optimisation for Mirwal.
 *
 * Why this exists: the original art was exported straight from an image generator at
 * 1400-2200px and 1-1.9MB per file, and shipped unchanged. The home page alone pulled
 * ~7MB of hero PNGs. See docs/PROJECT_AUDIT.md section 11.
 *
 * Policy:
 *   - Photographic art and illustrations  -> WebP, resized to the largest size actually rendered.
 *   - Brand logos                         -> PNG, resized. PNG is kept for the logo so the brand
 *                                            mark can never fail to render on an old browser.
 *   - Files are renamed to descriptive kebab-case (the originals carried generator timestamps
 *     and spaces, which are awkward in URLs and in imports).
 *
 * Run with:  npm run optimize:images
 */
import sharp from 'sharp'
import { readFile, writeFile, unlink, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const rel = (p) => path.relative(root, p).replaceAll('\\', '/')

/** [source, destination, { width, quality, format }] */
const jobs = [
  // Home page hero carousel — rendered at ~1240px wide, aspect-ratio 2.15, object-fit: cover.
  ['src/assets/hero-banner/ChatGPT Image Aug 23, 2026, 08_44_29 PM.png', 'src/assets/hero-banner/hero-1.webp', { width: 1600, quality: 76 }],
  ['src/assets/hero-banner/ChatGPT Image Aug 23, 2026, 08_47_21 PM.png', 'src/assets/hero-banner/hero-2.webp', { width: 1600, quality: 76 }],
  ['src/assets/hero-banner/ChatGPT Image Aug 23, 2026, 08_51_25 PM.png', 'src/assets/hero-banner/hero-3.webp', { width: 1600, quality: 76 }],
  ['src/assets/hero-banner/ChatGPT Image Aug 23, 2026, 09_03_13 PM.png', 'src/assets/hero-banner/hero-4.webp', { width: 1600, quality: 76 }],

  // Page banners and illustrations.
  ['src/assets/images/about us banner.png', 'src/assets/images/about-banner.webp', { width: 1600, quality: 76 }],
  ['src/assets/images/about us video-thumbnail.png', 'src/assets/images/about-video-thumbnail.webp', { width: 1200, quality: 76 }],
  ['src/assets/images/compare.png', 'src/assets/images/compare-banner.webp', { width: 1200, quality: 78 }],
  ['src/assets/images/mirwal shopping bag.png', 'src/assets/images/shopping-bag.webp', { width: 1000, quality: 80 }],
  ['src/assets/images/sel with mirwal hero.png', 'src/assets/images/seller-hero.webp', { width: 1400, quality: 78 }],
  ['src/assets/images/sell with mirwal rocket.png', 'src/assets/images/seller-rocket.webp', { width: 900, quality: 80 }],
  ['src/assets/images/sell with tmirwal shop.png', 'src/assets/images/seller-shop.webp', { width: 1200, quality: 78 }],

  // Brand logos. Rendered at 130-150px wide; 400px covers high-DPI comfortably.
  ['public/mirwal-word-logo.png', 'public/mirwal-word-logo.png', { width: 400, format: 'png' }],
  ['public/mirwal-word-logo-dark.png', 'public/mirwal-word-logo-dark.png', { width: 400, format: 'png' }],

  // Favicons, generated from the symbol mark (previously unreferenced by any code).
  ['src/assets/brand/mirwal-symbol-logo.png', 'public/favicon-32.png', { width: 32, format: 'png' }],
  ['src/assets/brand/mirwal-symbol-logo.png', 'public/favicon-192.png', { width: 192, format: 'png' }],
  ['src/assets/brand/mirwal-symbol-logo.png', 'public/apple-touch-icon.png', { width: 180, format: 'png' }],
]

/** Originals that are replaced by a renamed output and should not ship. */
const removeAfter = jobs
  .filter(([source, destination]) => source !== destination)
  .map(([source]) => source)
  .filter((source) => !source.includes('mirwal-symbol-logo'))

const kb = (bytes) => `${(bytes / 1024).toFixed(0)} KB`

async function run() {
  let before = 0
  let after = 0

  for (const [source, destination, options] of jobs) {
    const sourcePath = path.join(root, source)
    if (!existsSync(sourcePath)) {
      console.warn(`  skip (missing): ${source}`)
      continue
    }

    const input = await readFile(sourcePath)
    const pipeline = sharp(input).resize({ width: options.width, withoutEnlargement: true })
    const output = options.format === 'png'
      ? await pipeline.png({ compressionLevel: 9, palette: true }).toBuffer()
      : await pipeline.webp({ quality: options.quality }).toBuffer()

    await mkdir(path.dirname(path.join(root, destination)), { recursive: true })
    await writeFile(path.join(root, destination), output)

    before += input.length
    after += output.length
    console.log(`  ${kb(input.length).padStart(8)} -> ${kb(output.length).padStart(8)}   ${rel(destination)}`)
  }

  for (const source of removeAfter) {
    const sourcePath = path.join(root, source)
    if (existsSync(sourcePath)) await unlink(sourcePath)
  }

  console.log(`\n  total: ${kb(before)} -> ${kb(after)}  (${(100 - (after / before) * 100).toFixed(1)}% smaller)`)
}

run()
