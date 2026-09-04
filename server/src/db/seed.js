#!/usr/bin/env node
/**
 * DEVELOPMENT SEED DATA — NOT PRODUCTION DATA.
 *
 * Everything created here is obviously fictional and exists so the frontend, dashboards,
 * search and seller isolation can be exercised locally. It refuses to run when
 * NODE_ENV=production.
 *
 * Two sellers are created deliberately: proving "Seller A cannot reach Seller B" needs a
 * Seller B to exist.
 *
 * The product catalogue is lifted from the storefront's existing data/mockData.js so the
 * UI looks familiar during the migration, with the string prices parsed into DECIMAL and
 * the composite rating string split into an average and a count — the conflicts recorded
 * in docs/PROJECT_AUDIT.md §5.
 */
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { env } from '../config/env.js'
import { pool, query, withTransaction } from './pool.js'
import { hashPassword } from '../lib/password.js'

if (env.isProduction) {
  console.error('  Refusing to seed: NODE_ENV=production. Seed data is development-only.')
  process.exit(1)
}

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..')
const slugify = (value) => value.toLowerCase()
  .replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')

/** "Rs. 202,000" -> "202000.00" */
const parseMoney = (value) => {
  const digits = String(value ?? '').replace(/[^0-9]/g, '')
  return digits ? (Number(digits)).toFixed(2) : null
}

const DEV_PASSWORD = 'MirwalDev123!'

const DEV_USERS = [
  { email: 'admin@mirwal.test',    name: 'Dev Admin',        roles: ['admin', 'super_admin'] },
  { email: 'seller.a@mirwal.test', name: 'Dev Seller A',     roles: ['seller', 'customer'] },
  { email: 'seller.b@mirwal.test', name: 'Dev Seller B',     roles: ['seller', 'customer'] },
  { email: 'customer@mirwal.test', name: 'Dev Customer',     roles: ['customer'] },
]

const DEV_STORES = [
  { email: 'seller.a@mirwal.test', slug: 'dev-store-alpha', name: 'Dev Store Alpha', city: 'Lahore',
    description: 'Development seed store. Not a real business.' },
  { email: 'seller.b@mirwal.test', slug: 'dev-store-beta',  name: 'Dev Store Beta',  city: 'Karachi',
    description: 'Second development seed store, used to test seller isolation.' },
]

async function alreadySeeded() {
  const [{ count }] = await query("SELECT COUNT(*) AS count FROM users WHERE email LIKE '%@mirwal.test'")
  return Number(count) > 0
}

async function run() {
  console.log(`  seeding ${env.db.database} (development)\n`)

  if (await alreadySeeded()) {
    console.log('  already seeded — run `npm run db:reset` to rebuild from scratch')
    return
  }

  const passwordHash = await hashPassword(DEV_PASSWORD)

  // --- users and roles ------------------------------------------------------
  const userIds = new Map()
  for (const user of DEV_USERS) {
    const id = await withTransaction(async (connection) => {
      const [result] = await connection.execute(
        `INSERT INTO users (public_id, email, password_hash, full_name, status, email_verified_at)
         VALUES (?, ?, ?, ?, 'active', CURRENT_TIMESTAMP(3))`,
        [randomUUID(), user.email, passwordHash, user.name],
      )
      for (const role of user.roles) {
        await connection.execute(
          'INSERT INTO user_roles (user_id, role_id) SELECT ?, id FROM roles WHERE slug = ?',
          [result.insertId, role],
        )
      }
      return result.insertId
    })
    userIds.set(user.email, id)
  }
  console.log(`  users        ${userIds.size}`)

  // --- sellers --------------------------------------------------------------
  const sellerIds = new Map()
  for (const store of DEV_STORES) {
    const [result] = await pool.execute(
      `INSERT INTO sellers (public_id, user_id, slug, store_name, description, city,
                            status, approved_at)
       VALUES (?, ?, ?, ?, ?, ?, 'approved', CURRENT_TIMESTAMP(3))`,
      [randomUUID(), userIds.get(store.email), store.slug, store.name, store.description, store.city],
    )
    sellerIds.set(store.slug, result.insertId)
  }
  console.log(`  sellers      ${sellerIds.size}`)

  // --- catalogue ------------------------------------------------------------
  const { products: seedProducts, categories: seedCategories } =
    await import(pathToFileURL(path.join(REPO_ROOT, 'apps/storefront/src/data/mockData.js')).href)

  const categoryIds = new Map()
  for (const [index, [name, image]] of seedCategories.entries()) {
    if (name === 'More Categories') continue
    const [result] = await pool.execute(
      `INSERT INTO categories (slug, name, image_url, position, description)
       VALUES (?, ?, ?, ?, ?)`,
      [slugify(name), name, image, index, `Browse ${name} on Mirwal.`],
    )
    categoryIds.set(name, result.insertId)
  }
  console.log(`  categories   ${categoryIds.size}`)

  // Brand is not modelled in the source catalogue at all — these are generic product
  // opportunities (see docs/PROJECT_AUDIT.md), not listings from a named manufacturer.
  // A previous version of this seed derived a fake "brand" from the first word of each
  // product name (workable while names began with real companies like "Apple"/"Samsung",
  // nonsensical once they began with plain descriptors like "USB-C" or "Rechargeable").
  // Every product is left unbranded here rather than inventing one; real brands come from
  // the seller in production.
  const brandIds = new Map()
  console.log(`  brands       0 (none in source data — left unbranded)`)

  let productCount = 0
  const seededProductIds = new Map()
  for (const [index, product] of seedProducts.entries()) {
    // Alternate between the two dev stores so isolation has something to isolate.
    const sellerSlug = index % 2 === 0 ? 'dev-store-alpha' : 'dev-store-beta'
    const sellerId = sellerIds.get(sellerSlug)
    const categoryId = categoryIds.get(product.category)
    if (!categoryId) continue

    const price = parseMoney(product.price)
    const compareAt = parseMoney(product.old)

    await withTransaction(async (connection) => {
      const [inserted] = await connection.execute(
        `INSERT INTO products (public_id, seller_id, category_id, brand_id, slug, name, subtitle,
                               description, price, compare_at_price, status, published_at,
                               rating_average, rating_count, meta_title, meta_description)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', CURRENT_TIMESTAMP(3), ?, ?, ?, ?)`,
        [
          randomUUID(), sellerId, categoryId, brandIds.get(product.name.split(' ')[0]) ?? null,
          product.id, product.name, product.type,
          `${product.name} — development seed listing on Mirwal.`,
          price,
          // Only keep compare_at when it really is higher; the source data contains one
          // transposed pair that would otherwise violate ck_products_compare_at.
          compareAt && Number(compareAt) > Number(price) ? compareAt : null,
          // Zero on insert. These columns are recomputed from real product_reviews rows at
          // the end of this seed — see seedReviews(). They are never written from the mock
          // "4.8 (1.2k)" string any more, because that string was an invented rating being
          // rendered to shoppers as though buyers had left it.
          0, 0,
          `${product.name} | Mirwal`,
          `Buy ${product.name} on Mirwal. Compare price, ratings and delivery from marketplace sellers in Pakistan.`,
        ],
      )

      await connection.execute(
        `INSERT INTO product_images (product_id, url, alt_text, position) VALUES (?, ?, ?, 0)`,
        [inserted.insertId, product.image, product.name],
      )

      const [variant] = await connection.execute(
        `INSERT INTO product_variants (product_id, sku, name, is_default, position)
         VALUES (?, ?, 'Default', 1, 0)`,
        [inserted.insertId, `DEV-${sellerSlug === 'dev-store-alpha' ? 'A' : 'B'}-${String(index + 1).padStart(3, '0')}`],
      )

      // Varied stock so in-stock / low-stock / out-of-stock states are all reachable.
      const quantity = [0, 3, 12, 45, 120][index % 5]
      await connection.execute(
        'INSERT INTO inventory (variant_id, quantity, reserved) VALUES (?, ?, 0)',
        [variant.insertId, quantity],
      )

      seededProductIds.set(product.id, inserted.insertId)
    })
    productCount += 1
  }
  console.log(`  products     ${productCount}`)

  // --- active promotions ---------------------------------------------------
  // Attach sale records to real seeded products so the public Deals page has useful data.
  const saleProducts = seedProducts
    .filter((product) => product.old && seededProductIds.has(product.id))
    .slice(0, 12)
    .map((product) => seededProductIds.get(product.id))
  const promotions = [
    ['flash_sale', 'flash-sales', 'Flash Sales', 'Limited-time discounts on selected products.', 30, 30],
    ['promotion', 'clearance-event', 'Clearance Event', 'Extra savings while selected stock lasts.', 20, 20],
    ['campaign', 'weekend-campaign', 'Weekend Campaign', 'Special weekend offers from Mirwal sellers.', 10, 10],
  ]
  for (const [kind, slug, name, description, discount, priority] of promotions) {
    const [result] = await pool.execute(
      `INSERT INTO promotions (public_id, kind, slug, name, description, discount_type,
                              discount_bps, currency_code, starts_at, ends_at, status,
                              priority, created_by)
       VALUES (?, ?, ?, ?, ?, 'percentage', ?, 'PKR',
               CURRENT_TIMESTAMP(3), DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL 30 DAY),
               'active', ?, ?)` ,
      [randomUUID(), kind, slug, name, description, discount * 100, priority, userIds.get('admin@mirwal.test')],
    )
    const linkedProducts = kind === 'flash_sale' ? saleProducts.slice(0, 4) : kind === 'promotion' ? saleProducts.slice(4, 8) : saleProducts.slice(8, 12)
    for (const productId of linkedProducts) {
      await pool.execute(
        'INSERT INTO promotion_products (promotion_id, product_id) VALUES (?, ?)',
        [result.insertId, productId],
      )
    }
  }
  console.log(`  promotions   ${promotions.length} active sales`)

  await pool.execute(`
    UPDATE sellers s
       SET product_count = (SELECT COUNT(*) FROM products p
                             WHERE p.seller_id = s.id AND p.status = 'active')`)

  const reviewCount = await seedReviews()
  console.log(`  reviews      ${reviewCount} (on ${SEEDED_ORDER_COUNT} delivered seed orders)`)

  console.log(`
  Development accounts (password for all: ${DEV_PASSWORD})
    admin@mirwal.test     admin + super_admin
    seller.a@mirwal.test  seller (Dev Store Alpha)
    seller.b@mirwal.test  seller (Dev Store Beta)
    customer@mirwal.test  customer
`)
}

const SEEDED_ORDER_COUNT = 40

/**
 * Real delivered orders, and real reviews written against them.
 *
 * `products.rating_average` / `rating_count` used to be written straight from the mock
 * catalogue's `"4.8 (1.2k)"` string — an invented number rendered to shoppers as though
 * 1,200 buyers had rated the product, with no review anywhere behind it. Nothing else in
 * this schema was ever that dishonest, because everything else at least described a row
 * that existed.
 *
 * The fix is not to delete the ratings but to make them true: this creates real delivered
 * orders for the seed customer, real `product_reviews` rows referencing those order items,
 * and then recomputes the cached aggregate from those rows. Every star in the dev app is now
 * backed by a review a reader can actually open — seed data, clearly, in the same way the
 * seed products and seed sellers are, but internally consistent rather than fabricated.
 */
async function seedReviews() {
  const [[buyer]] = await pool.execute('SELECT id, full_name FROM users WHERE email = ?', ['customer@mirwal.test'])
  const [products] = await pool.execute(
    `SELECT p.id, p.seller_id, p.name, p.price, v.id AS variant_id, v.sku
       FROM products p
       JOIN product_variants v ON v.product_id = p.id
      WHERE p.status = 'active'
      ORDER BY p.id
      LIMIT ?`,
    [String(SEEDED_ORDER_COUNT)],
  )

  // Deterministic so a re-seed produces the same catalogue every time — a rating that moves
  // on every `npm run db:reset` makes any UI or ranking difference impossible to attribute.
  const RATINGS = [5, 4, 5, 3, 4, 5, 4, 2, 5, 4]
  const BODIES = [
    'Arrived quickly and works exactly as described. Happy with it.',
    'Good value for the price. Packaging could be better but the product is fine.',
    'Exactly what I needed. Would order from this seller again.',
    'Does the job, though it feels a little lighter than I expected.',
    'Solid quality and delivery to Lahore took two days.',
  ]

  let reviews = 0
  for (const [index, product] of products.entries()) {
    const rating = RATINGS[index % RATINGS.length]
    await withTransaction(async (connection) => {
      const [order] = await connection.execute(
        `INSERT INTO orders (public_id, order_number, buyer_id, subtotal, shipping_fee, total,
                             status, payment_method, payment_status, paid_at,
                             shipping_full_name, shipping_phone, shipping_line1, shipping_city)
         VALUES (?, ?, ?, ?, 0, ?, 'delivered', 'cod', 'paid', CURRENT_TIMESTAMP(3),
                 ?, '+923001234567', 'House 1, Street 1', 'Lahore')`,
        [randomUUID(), `MW-S${String(index + 1).padStart(5, '0')}`, buyer.id, product.price, product.price, buyer.full_name],
      )
      const [item] = await connection.execute(
        `INSERT INTO order_items (order_id, seller_id, product_id, variant_id, product_name,
                                  sku, unit_price, quantity, line_total, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, 'delivered')`,
        [order.insertId, product.seller_id, product.id, product.variant_id, product.name,
         product.sku, product.price, product.price],
      )
      await connection.execute(
        `INSERT INTO product_reviews (public_id, product_id, user_id, order_item_id, rating, title, body)
         VALUES (?, ?, ?, ?, ?, '', ?)`,
        [randomUUID(), product.id, buyer.id, item.insertId, rating, BODIES[index % BODIES.length]],
      )
    })
    reviews += 1
  }

  // The cached aggregate, derived — never typed in.
  await pool.execute(`
    UPDATE products p
       SET p.rating_average = COALESCE((SELECT ROUND(AVG(r.rating), 2) FROM product_reviews r WHERE r.product_id = p.id), 0),
           p.rating_count   = (SELECT COUNT(*) FROM product_reviews r WHERE r.product_id = p.id)`)

  return reviews
}

try {
  await run()
} catch (error) {
  console.error(`\n  seed failed: ${error.message}`)
  process.exitCode = 1
} finally {
  await pool.end()
}
