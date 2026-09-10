# MIRWAL — Phase 0 Project Audit

**Date:** 27 August 2026
**Repository:** `D:\GitHub Projects\Mirwal-v2` (`github.com/mawaisdaud786/mirwal-v2`)
**Audit type:** Sections 0–18 are the read-only Phase 0 audit and describe the project *as found*.
**Status:** Phase 0 complete. Approved remediation applied — see §19 for what has since changed.

---

## 0. How this audit was performed

| Activity | Detail |
|---|---|
| Static inspection | All 189 files under `src/`, plus `package.json`, `vite.config.js`, `index.html`, `.github/instructions`, `public/` |
| Live inspection | Vite dev server on `localhost:5173`; 40+ routes visited and probed programmatically |
| Build verification | `vite build` — passes; bundle and asset sizes measured |
| Lint verification | `eslint .` — passes with zero findings |
| Data verification | `mockData.js` parsed and validated programmatically for price/badge/rating consistency |
| Responsive testing | 375×812 (mobile) and desktop viewports; overflow and touch-target measurement |
| Security testing | Client-side privilege escalation test against the route guards |

**Two files were created, neither of which affects the application:**
- `.claude/launch.json` — dev-server launch config for the tooling
- `docs/PROJECT_AUDIT.md` — this document

---

## 1. Executive summary

Mirwal-v2 is a **React 19 + Vite 8 front-end prototype**. It is well-organised, lints clean, builds successfully, and contains a genuinely large amount of carefully-built UI: 224 routes, 99 page/component files, a complete admin shell, a complete seller shell, and a public storefront. The visual design work and the breadth of screen coverage are real assets and should be preserved.

However, the audit found a gap between what the project *presents* and what it *is*:

> **There is no backend, no database, and no network layer in this project. The application makes zero HTTP requests. Every price, order, seller, customer, payout, analytics figure and AI response on every screen is a hard-coded literal in the front-end source.**

This is not a criticism of the work done — it is a UI prototype and a good one. But it means the project brief's targets (multi-vendor marketplace, seller isolation, secure orders, grounded AI, real analytics) are **not partially implemented; they are not implemented at all**, and the roadmap must be read with that in mind.

### The five findings that gate everything else

| # | Finding | Severity |
|---|---|---|
| 1 | **No backend exists.** No Node/Express server, no MySQL schema, no API. `src/services/api.js` is written but imported by zero files and `VITE_API_BASE_URL` is never configured. | **Blocker** |
| 2 | **Authentication does not exist, and authorisation is self-asserted.** Login does nothing. Route guards read a role out of `localStorage`. Any visitor can grant themselves Super Admin with one console command — **verified live during this audit**. | **Critical** |
| 3 | **~20 MB of unoptimised images ship to the browser**, including four hero PNGs of 1.6–1.9 MB each on the home page and a 400 KB PNG logo in the header of every page. On the target market's mobile networks this is disqualifying. | **Critical** |
| 4 | **Half the interface is non-functional.** 434 of 865 buttons (50%) have no click handler; 113 of 144 `<select>` elements (78%) have no `onChange`; pagination, bulk actions, filters and view toggles are static decoration. | **High** |
| 5 | **Page metadata leaks between routes.** Titles, descriptions, canonicals and robots directives persist from the previously-visited page. The 404 page currently canonicalises to `/shipping` and is marked `index,follow`. Meanwhile the pages that *should* be indexed (`/sellers`, `/seller/:slug`, `/brands`, `/guides`) are marked `noindex`. | **High** |

### Overall classification

| Area | Verdict |
|---|---|
| Front-end structure, routing, code-splitting | **KEEP** — solid foundation |
| Visual design, page inventory, admin/seller shells | **KEEP / IMPROVE** |
| CSS architecture | **IMPROVE** — token system started, 60–65% done, desktop-first |
| Interactivity (buttons, forms, filters) | **FIX** — at scale |
| Data layer | **REPLACE** — string-typed mock data cannot support commerce |
| Auth / authorisation | **REPLACE** — currently unsafe by design |
| Backend, database, API | **MISSING** — build from scratch |
| AI assistant | **MISSING** — UI shell only, no model, no grounding |
| SEO infrastructure | **FIX + MISSING** — no robots.txt, no sitemap, leaking meta |

---

## 2. Architecture snapshot

### 2.1 What exists

```
Mirwal-v2/
├── index.html               static <head>, Font Awesome via CDN
├── vite.config.js           React plugin + file polling only
├── src/
│   ├── main.jsx             BrowserRouter + Bootstrap CSS & JS bundle
│   ├── App.jsx              224 routes, all guards, cart state (456 lines)
│   ├── auth.js              reads a role from localStorage
│   ├── navigation.js        module-level navigate() escape hatch
│   ├── services/api.js      ← written, never imported (dead)
│   ├── data/                mockData.js, sellerMockData.js, termsContent.js
│   ├── components/          Header, Footer, Icon, SEOHead, Modals, Comparison
│   ├── admin/               35 files — layout, sidebar, 30+ page modules
│   ├── seller/              25 files — layout, sidebar, 18 page modules
│   ├── styles/global.css    design tokens
│   └── *.jsx / *.css        ~35 public pages, 68 stylesheets
└── public/                  3 logo PNGs (1.8 MB), 1 SVG, 1 raw .md file
```

**Stack in use:** React 19.2, React Router 7.18, Vite 8.2, Bootstrap 5.3 (CSS + JS bundle), Font Awesome 6.7 (CDN). No state library, no data-fetching library, no test framework, no TypeScript.

**Stack in the brief but absent:** Node.js, Express, MySQL 8/InnoDB.

### 2.2 Route topology

| Segment | Route count | Guard |
|---|---|---|
| Public / customer | 40 | none (account paths check `role === 'customer'`) |
| `/admin/*` | 91 | `RequireRole role="admin"` (client-side) |
| `/seller/*` | 75 | `RequireRole role="seller"` (client-side) |
| **Total** | **224** | |

Separation of the three applications is **structurally correct and already in place** — separate route trees, separate layouts (`PublicLayout` / `AdminLayout` / `SellerLayout`), separate sidebars, separate CSS namespaces, and lazy-loaded admin/seller chunks. This satisfies the brief's "three application areas" requirement at the front-end level and should be **preserved, not rebuilt**. What is missing is the server-side half of the boundary.

### 2.3 Layout chrome mechanism — works, but is confusing

`PublicLayout` renders `<Header global />` and `<Footer global />`. Many pages *also* import and render their own `<Header />` / `<Footer />`. Duplication is avoided by `SiteChromeContext`: a non-`global` Header/Footer returns `null` when chrome is already mounted.

This works correctly (verified live — exactly one `<header>` and one `<footer>` per public page), but it means ~20 pages carry imports and JSX that render nothing. **Classification: REFACTOR** — remove the redundant per-page chrome once, in Phase 4.

---

## 3. Front-end ↔ backend audit

### 3.1 There is no integration to audit

```
Frontend  →  API endpoint  →  Controller  →  Service  →  Database
   ✔              ✘              ✘             ✘           ✘
```

Verified facts:

- `grep -rn "fetch(" src/` returns **exactly one** result: the definition inside `src/services/api.js`.
- `grep -rn "services/api" src/` returns **zero** results. Nothing imports it.
- `import.meta.env` appears once, in that same dead file.
- No `.env` or `.env.example` exists, so `VITE_API_BASE_URL` is empty and `request()` would throw `"Mirwal API is not configured"` on the first call anyway.

`src/services/api.js` is a well-shaped client (categories, brands, sellers, products, search, guides, intents, deals, reviews, wishlist, cart, orders, checkout) with bearer-token injection. It is a **useful design artefact and a good starting contract** — but it is currently dead code describing an API that does not exist.

**Classification: KEEP as a specification, but it must not be wired up until a real server exists behind it.**

### 3.2 What the front-end would need from a backend

Derived from what the UI currently fakes:

| Domain | Endpoints implied by existing screens |
|---|---|
| Catalog | products (list/detail/search/filter/sort/paginate), categories, brands, attributes, inventory |
| Sellers | store profile, products, orders, returns, reviews, customers, finance, payouts, shipping zones/methods/rates |
| Customers | auth, profile, addresses, payment methods, wishlist, cart, orders, tracking, returns, reviews, notifications |
| Orders | create (transactional), status history, disputes, returns, refunds |
| Admin | users, roles, teams, access control, sessions, activity, audit logs, approvals, complaints, blocked accounts, coupons, campaigns, banners, flash sales, tax/commission, payment settings, integrations, webhooks, system logs, backups, maintenance mode |
| AI | intent extraction, grounded product search, ranking, explanation, query logging |
| Analytics | admin + seller dashboards across 6 date ranges |

That is a very large surface. **Recommendation:** do not attempt it all in one phase — see §16.

---

## 4. Security audit

Because there is no server, every finding below is architectural rather than exploit-specific. Severity reflects what would happen if this front-end were deployed as-is.

### CRITICAL

**S-1 — Authorisation is client-side and self-asserted.**
`src/auth.js` reads `localStorage['mirwal-session']` and trusts its `role` field verbatim. `RequireRole` in `App.jsx` gates all 91 admin routes and 75 seller routes on that value.

**Verified live during this audit:** running

```js
localStorage.setItem('mirwal-session', JSON.stringify({ token: 'not-a-real-token', userId: 'anyone', role: 'admin' }))
```

in the browser console and navigating to `/admin` renders the full Super Admin Panel — sidebar, dashboard, all sub-pages. The token is never validated because there is nothing to validate it against.

The same applies to `role: 'seller'`. Today this exposes no real data (everything is mock), but the pattern must not survive contact with a real API.

**S-2 — Authentication does not exist.**
`AuthPage.submit()` calls `event.preventDefault()` and sets a message string. No credentials are transmitted, hashed, stored, or checked. Sign-in, sign-up, Google/Facebook/Apple buttons, "Forgot Password" and "Remember me" are all inert. Consequence: the admin and seller applications have **no legitimate way in** — only the localStorage bypass above.

**S-3 — There is no place to enforce seller isolation.**
The brief requires Seller A never to reach Seller B's data. There is no server, no ownership column, no query scoping. The seller app is hard-coded to a single fictional store (`SellerLayout` default `storeName = 'Awais Store'`, `sellerMockData.sellerStore`), so the isolation question has not yet been modelled at all.

### HIGH

**S-4 — The public header is permanently in a signed-in state.**
`Header.jsx` declares `isLoggedIn = true` as a default prop and **no caller ever passes it**. Every visitor, authenticated or not, sees an avatar (`i.pravatar.cc/80?img=11`), the name "Umar", and a My Profile / My Orders / Settings / Logout menu. The `Sign In` button branch is unreachable dead code. Users are shown a false identity.

**S-5 — Fabricated financial and compliance data is presented as the seller's own.**
`seller/pages/FinancePage.jsx` displays a specific bank ("Meezan Bank"), a specific IBAN (`PK36 MEZN 0000 1234 5678`), a tax number (`NTN-1234567`), and claims "Two-factor authentication: **Enabled**" and "Email verification: **Verified**". None of this is real. Security status claims in particular must never be hard-coded.

**S-6 — Fabricated operational data implies integrations that do not exist.**
`admin/AdminPage.jsx` shows backups to "Google Drive" and "Amazon S3" (42.6 GB, "Success"), maintenance-mode access-control entries with real-looking internal IPs (`192.168.1.10`, `10.0.0.1 – 10.0.0.50`), and a System Status panel reporting six services as "Operational". An operator could act on any of this.

### MEDIUM

**S-7 — No input validation layer.** Client-side `required` / `minLength` only; no schema validation anywhere, and no server to validate against.
**S-8 — No CSRF/CORS/rate-limiting/security-header posture** — nothing to configure them on yet, but there is also no plan artefact for them.
**S-9 — Raw markdown served from web root.** `public/Mirwal Terms & Conditions.md` (20 KB) is publicly fetchable at `/Mirwal%20Terms%20&%20Conditions.md`. Not linked, but crawlable.
**S-10 — Third-party CDN with no SRI.** Font Awesome loads from `cdnjs.cloudflare.com` in `index.html` with no `integrity` or `crossorigin` attribute.

### LOW

**S-11 — External avatar/image hosts.** `i.pravatar.cc` and `images.unsplash.com` are used for user avatars and all 35 product images. Fine for a prototype; a privacy and availability liability in production.

**Positive finding:** no secrets, API keys, credentials, or tokens are present anywhere in the source. Nothing is leaked because nothing exists.

---

## 5. Database audit

**There is no database.** No schema file, no migrations, no ORM, no connection code, no seed scripts.

The nearest artefact is `src/data/mockData.js`, which is the de-facto product model:

```js
{ id: 'apple-iphone-15', name: 'Apple iPhone 15 (128GB)', type: 'Smartphone',
  category: 'Electronics', price: 'Rs. 234,000', old: 'Rs. 202,000',
  rating: '4.8 (1.2k)', badge: '-30%', image: 'https://images.unsplash.com/...' }
```

35 products, 9 fields, **every value a string**.

### Measured gaps against the brief's required entities

| Required | Present |
|---|---|
| Users, Roles, Permissions | ✘ |
| Sellers | ✘ — **0 of 35 products carry a seller field** |
| Categories | partial — a flat 8-item array of `[name, imageUrl]`, no ids, no parent/child, no slugs |
| Products | partial — see below |
| Variants | ✘ — 0 of 35 |
| Product images | ✘ — one URL per product; 0 of 35 have a gallery |
| Inventory / stock | ✘ — 0 of 35 |
| Cart | React state only; lost on refresh |
| Wishlist | `localStorage` array of ids |
| Orders, Order items, Payments, Shipments, Returns, Refunds | ✘ |
| Reviews | ✘ — `reviewSeed = []`, reviews live in component state |
| Coupons, Promotions | ✘ — coupon field accepts any string |
| Notifications, Audit logs, AI requests, Analytics | ✘ |

### Data-integrity defects found in the existing mock data

**D-1 — `apple-iphone-15` has an inverted price.** `price: 'Rs. 234,000'`, `old: 'Rs. 202,000'`. The UI renders `old` with a strikethrough as the "original" price, so the product page and every listing **display a price increase as a discount**. The `badge: '-30%'` is also wrong — the real change is **+16%**. Because cart and checkout compute savings as `Math.max(0, old - current)`, this item silently contributes `Rs. 0` to the "You are saving…" line.

**D-2 — Money is stored as a formatted string.** Every price is parsed back with `parseInt(item.price.replace(/\D/g, ''), 10)` in **six separate places** (`CartPage`, `CheckoutPage`, `SearchResultsPage`, `CategoriesPage`, `ExplorePage`, `ComparePage`), each with its own copy of the helper. This is unworkable for tax, commission, discounts or refunds. Money must become `DECIMAL(12,2)` server-side and integers/minor-units client-side.

**D-3 — Ratings are strings, and this silently breaks sorting.** `rating: '4.8 (1.2k)'`. Both `SearchResultsPage` and `CategoriesPage` sort with `Number(b.rating) - Number(a.rating)`, which evaluates to `NaN` for every pair. **"Sort by rating" and the default "Recommended" sort on category pages do nothing.** No error is shown.

**D-4 — An advertised category has no products.** `categories` lists `Automotive`, it appears in the nav and the browse grid, and `/category/automotive` renders a full category page with three subcategories — but **zero of the 35 products are in it**. The category card masks this by printing `'Explore'` where the product count should be.

**D-5 — Brand is not modelled.** Search and compare derive "brand" via `product.name.split(' ')[0]`, producing a filter list containing `Premium`, `Modern`, `Instant`, `New` (from "New Balance"), and `La` (from "La Roche-Posay").

**Classification: REPLACE.** The data model must be rebuilt around typed values and real relations before any commerce logic is written.

---

## 6. Page-by-page audit

Every route below was visited on the running dev server. `Meta` reflects what the document head actually contained on arrival.

### 6.1 Public / customer

| Route | Purpose | Status | Key findings |
|---|---|---|---|
| `/` | Home | **PARTIALLY WORKING** | 4 hero PNGs totalling ~7 MB. "Shop by Need" → `/explore?need=work` and "Shop by Budget" → `/explore?budget=25000`; **neither `need` nor `budget` is read by Explore**, so both land unfiltered. No page-specific title/canonical. |
| `/products` | Product listing | **INCORRECT** | H1 reads "Explore", duplicating `/explore`. Inherits the home page's generic title and description — no SEO of its own. 13 dead buttons. |
| `/product/:slug`, `/products/:id` | Product detail | **PARTIALLY WORKING** | Best-built public page: real tabs, working gallery, Product schema, correct canonical. But: colour swatches hard-coded to Black/Silver/Rose Gold/Blue **for every product** (a yoga mat offers Rose Gold); "Only 8 items left!" and "In Stock · Ships within 24 hours" are hard-coded for all; warranty hard-coded to "1 Year"; every product is "Sold by Awais Store"; Q&A tab renders empty with no empty state; the Reviews summary says "Based on 1.2k reviews" above an empty list. Review submit says *"Your review was added successfully"* and question submit says *"Your question was sent to the seller"* — **both are false**, nothing leaves the browser. Two URL patterns serve this page. |
| `/categories`, `/categories/:slug`, `/category/:slug` | Category browse | **PARTIALLY WORKING** | Good SEO shape and correct canonicalisation of `/category/*` → `/categories/*`. Filter and price sorts work. Rating/Recommended sort broken (D-3). Automotive empty (D-4). |
| `/explore` | Faceted discovery | **WORKING** | The most complete page in the app: multi-select category/brand/type/rating facets, price range, discount, availability, sort, pagination, URL-synced state. **Preserve this — it is the reference implementation for the rest of the site.** |
| `/search` | Search results | **PARTIALLY WORKING** | Live filtering, price slider and "Load more" work. Rating sort broken. Brand facet is garbage (D-5). Product links use raw `<a href>` → full page reload. Compare checkbox has no handler. |
| `/deals`, `/deals/:slug` | Deals | **PARTIALLY WORKING** | 15 dead buttons. Pagination is four static number buttons. "Clear all filters" and both "Show more" buttons do nothing. `marketplace-polish.css` ends with `.deal-clock { display: none; }` — a countdown feature hidden rather than removed. |
| `/compare` | Comparison | **WORKING** | Genuine feature. `ComparisonContext` persists up to 4 products in `sessionStorage`; add/remove/clear all work. Compares only 6 attributes, and falls back to "Check product page" / "Marketplace seller" because the data has no availability or seller fields. |
| `/cart` | Cart | **PARTIALLY WORKING** | Quantity, remove and clear work. But: state lives in `App`'s `useState`, so **the cart is emptied by a page refresh**; "Color: Black" is hard-coded on every line; the discount badge falls back to a literal `'-20%'`; "Move to Wishlist" and "Update Cart" are dead; "Select All" and per-row checkboxes affect nothing. |
| `/checkout` | Checkout | **BROKEN** | Guarded by `role === 'customer'`, which is unreachable, so **the page cannot legitimately be opened**. All eight shipping fields are pre-filled with a fictional person: "Awais Ahmed", "+92 300 1234567", "awaisahmed@example.com", "House # 123, Street 45, Block A", Lahore, 54000. Coupon "Apply" sets a green ✓ for **any** non-empty string with no validation. Place Order returns *"Checkout is not connected to an order or payment service…"*. Claims "256-bit encrypted" and "Total (VAT incl.)" with no tax calculation anywhere. |
| `/order-success/:orderId` | Confirmation | **INCOMPLETE (honest)** | Correctly states that no verified order was found and refuses to fabricate one. **This is the right pattern** — the rest of the app should adopt it. Unreachable in practice. |
| `/login`, `/register` | Auth | **BROKEN** | See S-2. Social buttons, Remember me and Forgot Password are inert. |
| `/profile` and 12 account paths | Account | **BROKEN (unreachable)** | All gated on `role === 'customer'`. `AccountShell` routes clicks by **matching `button.textContent`** against a lookup table — renaming any label silently breaks navigation. |
| `/sellers`, `/seller/:slug` | Public seller pages | **PARTIALLY WORKING** | Thin (995 chars of body text on `/sellers`). Marked `noindex,follow` — **the opposite of the brief**, which names `/seller/:slug` as a target indexable route. |
| `/brands`, `/brands/:slug`, `/brand/:a/:b` | Brands | **INCOMPLETE** | Three URL shapes for one page. `noindex`. Brand is not a real entity (D-5). |
| `/guides`, `/guides/:slug`, `/blog` | Content | **INCORRECT** | `/blog` and `/guides` render **identical content**. Canonical correctly points at `/guides`, but the `/blog` route is redundant and `BlogPage.jsx` is orphaned. Both `noindex`. |
| `/ai-shopping`, `/ai-assistant` | AI assistant | **BROKEN** | See §9. |
| `/about` | About | **PARTIALLY WORKING** | Content is fine. **Inherits the previous page's `<title>`** entirely. |
| `/terms` | Terms | **WORKING** | Genuinely substantial (16 KB of real content from `termsContent.js`). Correct title and canonical. Marked `noindex` — should be `index`. |
| `/privacy` | Privacy | **INCOMPLETE** | Its own meta description admits it is *"A structured place for Mirwal's final privacy policy"* — i.e. a placeholder. 2.6 KB. |
| `/contact`, `/faq`, `/shipping`, `/returns-refunds`, `/cookies`, `/trust-safety`, `/buyer-protection`, `/safe-shopping`, `/payment-security`, `/order-tracking`, `/seller-verification`, `/seller-protection`, `/how-mirwal-works` | Trust pages | **PARTIALLY WORKING** | Consistent shell, thin content (~2.6 KB each). `/returns` (ContentPage) and `/returns-refunds` (TrustRoute) are **two different returns pages**. |
| `/help-center`, `/help` | Help | **PARTIALLY WORKING** | 90 buttons, most dead. Inherits previous page's title and canonical. |
| `/sell-with-mirwal`, `/sell-with-mirwal/apply` | Seller acquisition | **PARTIALLY WORKING** | Application form submits nowhere. Inherits previous title/canonical. |
| `/404`, `*` | Not found | **INCORRECT** | Renders correctly but **inherits the previous page's `<title>` and canonical (observed: `canonical=/shipping`) and is marked `index,follow`** — a soft-404 that invites indexing under the wrong URL. |

### 6.2 Admin application (91 routes)

Shell quality is good: collapsible sidebar with persisted state, mobile drawer with backdrop, breadcrumbs, consistent `Heading`/`Kpis`/`Filters`/`Table` primitives in `AdminComponents.jsx`, real `EmptyState`/`LoadingState`/`ErrorState` components, and a working paginated `Table` with page-size control.

| Finding | Detail |
|---|---|
| **A-1 — Dashboard is entirely fabricated** | GMV "Rs. 12.84M", 8,421 orders, 52,421 customers, 1,284 sellers, 84,291 products, 24,842 AI queries — all literals. Both charts are hard-coded SVG paths. The date reads "May 24, 2025" and the greeting is always "Good morning". The 7D/30D/3M/12M range buttons set state that nothing consumes. The only working interaction on the page is the Latest Orders status tab filter. |
| **A-2 — Approve/Reject do nothing** | The Pending Approvals panel renders ✓ and ✗ buttons per row with no handlers. |
| **A-3 — Bulk actions are dead but enabled** | `AdminProducts` enables "Bulk Publish / Unpublish / Delete" once rows are selected, then does nothing on click, with no feedback. |
| **A-4 — The admin app has no 404** | `AdminPage` is a placeholder *generator*: it title-cases the last URL segment and renders an EmptyState. `/admin/nonexistent-page` renders a page headed **"Nonexistent Page"**. Three real sidebar links (`/admin/store-applications`, `/admin/backup`, `/admin/maintenance`) fall through to it. |
| **A-5 — `<style>` blocks injected in JSX** | `AdminPage.jsx` (3) and `AdminSystemLogs.jsx` (2) embed large CSS blocks inside components, using hard-coded hex colours (`#e3eaf0`, `#7d8c98`, `#fafbfd`…) that bypass the design-token system, and `font-size: 8px`/`9px` for table content. |
| **A-6 — Non-functional tabs and toggles** | `AdminSubpage` tab buttons have no `onClick`. Settings switches render as static `fa-toggle-on` / `fa-toggle-off` **icons**, not inputs — not clickable, not focusable, not announced. |
| **A-7 — Fake pagination variant** | `Table`'s `paginationVariant="links"` branch renders `‹ 1 2 3 4 ›` as plain text. |
| **A-8 — No metadata management** | Every admin route inherits the last public page's title/description/canonical and is `index,follow`. |

**Classification: KEEP the shell and the shared primitives. FIX the dead controls. REPLACE all data. ADD an admin 404 and admin-wide `noindex`.**

### 6.3 Seller application (75 routes)

All 23 sidebar links resolve to real routes — **no dead links in the seller nav**, which is better than admin.

| Finding | Detail |
|---|---|
| **SE-1 — Dashboard is fabricated** | Rs. totals from `sellerStats`, plus literal `'324'` orders, `'12,540'` visitors, `'2.58%'` conversion, `'4.8/5'` rating. Chart is a hard-coded `<polyline>`. Date range reads "May 18 – May 24, 2025". |
| **SE-2 — Single hard-coded store** | `storeName = 'Awais Store'` is a default prop; `sellerMockData.sellerStore` is the only store. There is no notion of *which* seller is signed in — the concept the entire brief depends on. |
| **SE-3 — Fabricated bank / tax / security state** | See S-5. |
| **SE-4 — `Dashboard.jsx` is a one-line re-export** | `export { default } from './SellerDashboard'`. Two files, one component; `App.jsx` imports the re-export. |
| **SE-5 — Highest dead-button concentration** | `ShippingSettings.jsx` (24), `StoreProfile.jsx` (19), `Reviews.jsx` (16). Nine shipping sub-pages of zones/methods/rates/providers/tracking are read-only mock displays. |
| **SE-6 — Fake pagination** | Static `1 2 3` buttons on Products and Orders. |

**Classification: KEEP the shell, layout and page inventory. FIX controls. REPLACE data and introduce a real seller identity.**

---

## 7. Content audit

| Page / file | Current content | Problem | Recommended |
|---|---|---|---|
| `components/Header.jsx` | Tagline "Smart Shopping, Better Living" | — | Canonical tagline — keep |
| `components/Footer.jsx` | Brand tagline "All finds. You choose." | Second, conflicting tagline in the same viewport | Use one tagline platform-wide |
| `components/Footer.jsx` | "Careers", "Press & Media", "Google Play", "App Store" rendered as `<span>` | Look like links, do nothing; app stores implied that do not exist | Remove until real, or mark "Coming soon" |
| `components/Footer.jsx` | Bottom bar "Privacy Policy   Terms of Service" | Plain text, not links, duplicating the column above | Make them links or delete |
| `components/Footer.jsx` | "How Mirwal Works" → `/about` | A dedicated `/how-mirwal-works` route exists | Point at the real route |
| `components/Footer.jsx` | "Seller Center" → `/seller` | Public users are bounced to `/login` | Point at `/sell-with-mirwal` |
| `AuthPage.jsx` | "Join 50,000+ happy shoppers" | Fabricated social proof | Remove until measurable |
| `AuthPage.jsx` | "Your data is 100% protected", "100% Secure" | Absolute security claim; nothing is implemented | Remove |
| `AuthPage.jsx` | "7 Days Return", "24/7 Customer Support", "Fast Delivery Across Pakistan" | Operational promises with no policy or staffing behind them | Align with the actual returns policy or remove |
| `CheckoutPage.jsx` | Pre-filled "Awais Ahmed", `+92 300 1234567`, `awaisahmed@example.com`, "House # 123, Street 45, Block A" | Demo PII in a production checkout | Empty fields with placeholders |
| `CheckoutPage.jsx` | "256-bit encrypted"; "Total (VAT incl.)" | Unsupported claim; no tax is calculated | Remove both until true |
| `ProductPage.jsx` | "Only 8 items left!" | Hard-coded false scarcity on every product | Drive from real stock, or remove |
| `ProductPage.jsx` | "Free Delivery on orders over Rs. 2,000" | Contradicts checkout, where standard delivery is always free | Single source of truth for delivery rules |
| `ProductPage.jsx` | "1 Year warranty · Official warranty" | Hard-coded for all products including a yoga mat | Per-product field |
| `ProductPage.jsx` | Swatches Black / Silver / Rose Gold / Blue | Same four colours for every product | Real variants, or hide |
| `HomePage.jsx` | `popularBrands = ['Daraz', 'PriceOye', 'Telemart', …]` | **Named competitor marketplaces presented as Mirwal brands** | Replace with real product brands |
| `data/mockData.js` | 3 named testimonials with `pravatar` faces | Fabricated customer reviews with fabricated portraits | Remove until real reviews exist |
| `admin/AdminDashboard.jsx` | All KPIs, activity feed, seller table, AI stats, System Status "Operational" | Fabricated operational data | Real data or empty states |
| `admin/AdminPage.jsx` | Backups to Google Drive / Amazon S3; maintenance IP allow-lists | Implies integrations that do not exist | Remove until real |
| `seller/pages/FinancePage.jsx` | Meezan Bank, IBAN, NTN, 2FA "Enabled" | Fabricated financial/compliance data | Remove; never hard-code security state |
| `seller/pages/FinancePage.jsx` | Store is "Awais Store" but Business Name field says "Mirwal Store" | Internally inconsistent on one page | Single store identity |
| `/privacy` | "A structured place for Mirwal's final privacy policy" | Self-declared placeholder on a legally-required page | Write the real policy |
| `README.md` | Default Vite template README | No project documentation at all | Replace with Mirwal setup/run docs |
| Naming | "AI Shopping" (header) / "AI Solution" (assistant sidebar) / "Mirwal AI Assistant" (page) / "Mirwal AI" (admin) | Four names for one feature | Pick one |

---

## 8. Functionality audit

Measured across all `.jsx` files:

| Control | Total | Wired | Dead | Dead % |
|---|---:|---:|---:|---:|
| `<button>` (no `onClick`, not submit) | 865 | 431 | **434** | **50%** |
| `<select>` (no `onChange`) | 144 | 31 | **113** | **78%** |
| `<input>` (no `onChange` / `readOnly`) | 278 | 96 | **182** | **65%** |
| `<textarea>` | 25 | 7 | 18 | 72% |
| `<form>` (with `onSubmit`) | 30 | 28 | 2 | 7% |

The 28 wired forms are misleading: most handlers either set a local message string ("not connected yet") or mutate component state that is discarded on navigation.

### Classification by feature

| Feature | Status |
|---|---|
| Explore facets, sort, pagination, URL sync | **WORKING** |
| Product comparison (add/remove/clear, sessionStorage) | **WORKING** |
| Product gallery, tabs, quantity | **WORKING** |
| Cart add / quantity / remove / clear | **WORKING** (not persisted) |
| Category filter + price sort | **PARTIALLY WORKING** (rating sort broken) |
| Search keyword / price / load-more | **PARTIALLY WORKING** (rating sort, brand facet broken) |
| Header search → `/search?q=` | **WORKING** |
| Header category dropdown (nav bar) | **BROKEN** — sets state, never navigates |
| Wishlist | **PARTIALLY WORKING** — heart icons are per-component local state; only the account page persists ids |
| "Shop by Need" / "Shop by Budget" | **BROKEN** — params ignored by Explore |
| Login / Register / Social login | **NOT CONNECTED** |
| Checkout / Place Order | **NOT CONNECTED** |
| Coupon validation | **FAKE** — accepts any string |
| Review submit / Question submit | **FAKE** — reports success, sends nothing |
| Admin approve / reject / bulk actions | **NOT CONNECTED** |
| Admin & seller pagination (static number buttons) | **FAKE** |
| Admin/seller settings toggles | **FAKE** — static icons |
| Seller shipping zones / methods / rates | **NOT CONNECTED** |
| AI assistant | **BROKEN** — see §9 |

---

## 9. AI audit

`AiAssistantPage.jsx` is a well-built chat *shell* with a sidebar, suggested prompts, a "How Mirwal AI works" explainer, recent-chat list and a settings modal.

**It contains no AI.**

`submitMessage` pushes the user's text into a local array and clears the input. Nothing else happens. The renderer has a branch for `item.role === 'bot'` — **no code path ever creates a bot message**. A user types a question and receives silence, permanently.

| Brief requirement | Status |
|---|---|
| AI functionality exists | ✘ — no model, no provider, no endpoint |
| Intent extraction | ✘ |
| Structured search criteria | ✘ |
| Backend product search | ✘ |
| Grounding in verified product data | ✘ — nothing to ground |
| Hallucination prevention | N/A |
| Query logging / request tracking | ✘ — admin AI screens show fabricated counts (24,842 queries) |
| Clarifying questions | ✘ |

Additional issues: "Popular needs" buttons have no handlers; the microphone button does nothing; the two settings toggles are `defaultChecked` with no state; the four "recent chats" are hard-coded seeds presented as the user's own history; and the page is rendered inside `PublicLayout` (which supplies a Header) while also rendering its own full-height sidebar.

The admin side (`/admin/ai`, `/admin/ai/queries`, `/admin/ai/recommendations`, `/admin/ai/comparisons`, `/admin/ai/analytics`) is UI over fabricated numbers.

**Classification: MISSING.** The UI shell is worth keeping; the entire pipeline described in the brief must be built.

---

## 10. SEO audit

The project has partial SEO plumbing (`SEOHead.jsx` sets title, description, robots, Open Graph, Twitter, canonical and JSON-LD) but its application is inconsistent, and one implementation detail causes a systematic defect.

### The core defect: metadata leaks between routes

`SEOHead` only writes the tags it is given, and **nothing clears them on unmount**. Any route that does not render a `SEOHead` (or renders one without a `canonical`) inherits the previous page's values. Observed live, in sequence:

| Visited | `<title>` shown | `canonical` shown | `robots` |
|---|---|---|---|
| `/deals` | Deals and offers ✔ | **`/categories/electronics`** ✘ | index |
| `/compare` | Compare products ✔ | **`/categories/electronics`** ✘ | index |
| `/search?q=laptop` | Search results ✔ | **`/categories/electronics`** ✘ | noindex ✔ |
| `/about` | **Shopping Guides \| Mirwal** ✘ | `/guides` ✘ | noindex |
| `/help-center` | **Shipping & Delivery \| Mirwal** ✘ | `/shipping` ✘ | index |
| `/sell-with-mirwal` | **Shipping & Delivery \| Mirwal** ✘ | `/shipping` ✘ | index |
| **`/404`** | **AI Shopping Assistant \| Mirwal** ✘ | **`/shipping`** ✘ | **index,follow** ✘ |
| `/admin/*` (all 91) | previous public page's title ✘ | `/shipping` ✘ | **index,follow** ✘ |

### Index/noindex is inverted relative to the brief

| Route | Current | Brief wants |
|---|---|---|
| `/seller/:slug` | `noindex,follow` | **indexable** |
| `/sellers` | `noindex,follow` | indexable |
| `/brands`, `/brands/:slug` | `noindex,follow` | indexable |
| `/guides`, `/guides/:slug` | `noindex,follow` | indexable |
| `/terms`, `/privacy` | `noindex,follow` | indexable |
| `/admin/*`, `/seller/*` (panels) | `index,follow` | **noindex** |
| `/404` | `index,follow` | noindex |
| `/cart`, `/checkout` | noindex ✔ | noindex ✔ |
| `/search` | noindex,follow ✔ | ✔ |

### Missing infrastructure

- **No `robots.txt`.** Not present in `public/`.
- **No `sitemap.xml`** (and none of the per-type sitemaps the brief asks for).
- **No SSR/prerender.** A pure client-rendered SPA on Vercel means every crawler receives an empty `<div id="root">`. All the metadata work above is invisible to any crawler that does not execute JavaScript. **This is the single largest SEO decision the project has not yet made** and it must be settled before Phase 12.
- **No breadcrumb schema** despite breadcrumbs on most pages. **No Organization schema.** Product schema exists on one page.
- Product schema currently publishes `aggregateRating` derived from **fabricated** ratings and omits `offers` — publishing invented review data as structured markup is a policy risk with search engines.

### Duplicate URL patterns

| Content | URLs |
|---|---|
| Product | `/products/:id`, `/product/:productSlug` |
| Category | `/categories/:slug`, `/category/:slug` (canonical correctly unifies these ✔) |
| Guides | `/guides`, `/blog` (canonical unifies ✔) |
| Brands | `/brands/:slug`, `/brand/:brandSlug`, `/brand/:brandSlug/:categorySlug` |
| Help | `/help-center`, `/help` |
| Returns | `/returns` and `/returns-refunds` — **different pages, overlapping topic** |
| AI | `/ai-assistant`, `/ai-shopping` |
| Report | `/report-problem`, `/report` |

### Other

- Favicon is declared as `type="image/svg+xml"` but points at a **PNG** (`/mirwal-word-logo.png`, 400 KB). The previous `favicon.svg` was deleted.
- H1 text is mangled by `<br/>` on several pages: "Smart ShoppingStarts Here", "Sell with MirwalGrow Your Business Online", "Smarter Shopping,Happier Living."
- `/products` H1 "Explore" duplicates `/explore` H1 "Explore Products".
- 16 of 58 images on the home page use `alt=""` (decorative). Heading hierarchy is clean — H1→H2 with no skips on every page checked.

---

## 11. Performance audit

Measured from a production build (`vite build`, passes in 3.6 s).

### Images — the dominant problem

| Asset | Size | Where it loads |
|---|---:|---|
| `ChatGPT Image Aug 23, 2026, 08_47_21 PM.png` | **1.87 MB** | Home hero carousel |
| `ChatGPT Image Aug 23, 2026, 08_51_25 PM.png` | **1.79 MB** | Home hero carousel |
| `ChatGPT Image Aug 23, 2026, 08_44_29 PM.png` | **1.78 MB** | Home hero carousel |
| `ChatGPT Image Aug 23, 2026, 09_03_13 PM.png` | **1.63 MB** | Home hero carousel |
| `about us video-thumbnail.png` | 1.77 MB | `/about` |
| `mirwal shopping bag.png` | 1.63 MB | |
| `sel with mirwal hero.png` | 1.53 MB | `/sell-with-mirwal` |
| `about us banner.png` | 1.51 MB | `/about` |
| `sell with tmirwal shop.png` | 1.11 MB | |
| `sell with mirwal rocket.png` | 1.06 MB | |
| `compare.png` | 1.00 MB | `/compare` |
| `public/mirwal-symbol-logo.png` | 973 KB | |
| `public/mirwal-word-logo-dark.png` | 441 KB | |
| `public/mirwal-word-logo.png` | **400 KB** | **Header on every page + favicon** |

**Total `dist/`: 20 MB, of which ~19 MB is images.** The home page alone pulls roughly **7 MB of hero PNGs**. All are AI-generated source files that were never resized, compressed, or converted. None are served as WebP/AVIF, none are responsive (`srcset`), and the hero images are above the fold so none are lazy-loaded.

For a Pakistan-focused, mobile-first marketplace this is the highest-impact defect in the entire project, and it is also among the cheapest to fix.

Secondary: source filenames contain spaces and timestamps (`ChatGPT Image Aug 23, 2026, 08_44_29 PM.png`), which is unprofessional and awkward in URLs.

### JavaScript

- Main chunk: **659 KB raw / 178 KB gzip** — over Vite's 500 KB warning threshold.
- Admin and seller code **is** correctly lazy-loaded into ~60 small chunks (2–32 KB each). Good.
- The main chunk carries all public pages plus **the entire Bootstrap CSS and JS bundle**, which is used for exactly **four** `data-bs-toggle="dropdown"` attributes in `Header.jsx`. That is a very poor trade.

### Other

- 10 of ~30 page files use `loading="lazy"`; 20 do not.
- Font Awesome loads as a full CDN stylesheet in `index.html` (blocking, un-subsetted, no SRI).
- `vite.config.js` sets `server.watch.usePolling: true` — a local dev workaround that costs CPU; harmless in production but worth a comment.
- `dist/` and `dist.zip` are present in the working tree (`dist.zip` is untracked and not covered by `.gitignore`).

---

## 12. Accessibility audit

Measured on the live home page.

| Check | Result |
|---|---|
| Landmarks (`main`/`nav`/`header`/`footer`) | ✔ present, exactly one each (plus 2 `nav`) |
| Heading hierarchy | ✔ single H1, H2s below, no skipped levels on any page checked |
| Images with `alt` | ✔ 58/58 have the attribute (16 intentionally empty) |
| Form controls with an accessible name | ✔ 0 unlabelled |
| Buttons with an accessible name | ✔ 196/197 (1 unnamed) |
| `prefers-reduced-motion` support | ✔ 11 media queries |
| Horizontal overflow at 375 px | ✔ none |
| **Touch targets ≥ 44×44 px** | ✘ **117 of 221 fail (53%)** |
| **Body text size** | ✘ see below |

**A11Y-1 — Touch targets.** At 375 px the header's AI Shopping / Wishlist / Cart buttons are **34×34**, the menu toggle is **40×40**, the user menu is **48×34**, "Search Products" is **87×38**. More than half of all tappable elements are undersized for a mobile-first product.

**A11Y-2 — Text is far too small.** The design tokens set `--font-size-xs: 8px`, `--font-size-sm: 9px`, `--font-size-md: 10px`, `--font-size-base: 11px`, and `--text-body: 14px`. On the home page the live distribution is:

| Size | Elements |
|---|---:|
| 8 px | 6 |
| 10 px | 66 |
| 11 px | 41 |
| 12 px | 73 |
| 13 px | 40 |
| ≥ 16 px | 10 |

Admin tables and the injected `<style>` blocks use `font-size: 8px` and `9px` for real data cells. This is a readability failure for all users and a hard accessibility failure for many.

**A11Y-3 — Settings switches are icons, not controls.** Admin/seller toggles render `<i class="fa-solid fa-toggle-on">`. Not focusable, not operable by keyboard, not announced by a screen reader, and not actually a control.

**A11Y-4 — Click handlers on non-interactive elements.** `ProductPage`'s related-product cards put `onClick` on `<article>`; `AccountShell` attaches a delegated click handler to a `<div>` and dispatches on button *text*. Neither is keyboard-reachable in the intended way.

**A11Y-5 — Not verified in this phase.** Colour contrast was not systematically measured, and no screen-reader pass was performed. Both should be scheduled for Phase 18.

---

## 13. Code quality audit

**Strengths worth stating plainly:** ESLint passes with zero findings. The build is clean. Route organisation is logical. Admin and seller code is properly lazy-loaded. Shared primitives (`AdminComponents`, `SellerComponents`, `PageStates`, `Icon`, `SEOHead`, `ComparisonContext`) already exist and are used widely — `Icon` is imported by 71 files.

### Issues

| ID | Issue | Detail |
|---|---|---|
| Q-1 | **Dead files** | `src/BlogPage.jsx` (0 importers), `src/ExploreDiscoverySections.jsx` (0 importers), `src/services/api.js` (0 importers) |
| Q-2 | **Duplicated icon helper** | 21 files each declare their own local `const FaIcon = ({name}) => <i className={...}/>`, identical to the shared `components/Icon.jsx` |
| Q-3 | **Duplicated money parsing** | `parseInt(price.replace(/\D/g,''))` reimplemented in 6 files |
| Q-4 | **Pointless indirection** | `seller/pages/Dashboard.jsx` is a one-line re-export of `SellerDashboard.jsx` |
| Q-5 | **CSS in JSX** | 5 `<style>` blocks in `AdminPage.jsx` and `AdminSystemLogs.jsx` |
| Q-6 | **Override layer** | `marketplace-polish.css` is a patch file of cross-cutting overrides, ending in `.deal-clock { display: none; }` — a feature hidden rather than removed |
| Q-7 | **Extremely long single lines** | Most page components render their entire tree on one line of several thousand characters, making review and diffs impractical |
| Q-8 | **Routing by string matching** | `AccountShell` maps `button.textContent` to routes |
| Q-9 | **Global mutable navigate** | `navigation.js` stores the router's `navigate` in a module-level variable set from a `useEffect`; works, but bypasses React's data flow and is unsafe under concurrent rendering |
| Q-10 | **Deep prop drilling** | `cartCount` / `onAddToCart` threaded through most public routes; several components (e.g. `AiAssistantPage`) receive props they ignore |
| Q-11 | **Un-ignored build artefact** | `dist.zip` sits untracked in the repo root |
| Q-12 | **Uncommitted work** | 133 modified/untracked paths, including 2 deleted `public/*.svg` and 2 deleted seller pages (`Coupons.jsx`, `Earnings.jsx`). This should be committed or reverted before Phase 1 so changes are reviewable |
| Q-13 | **Documentation** | `README.md` is the stock Vite template. `REFACTORING_REPORT.md` documents the CSS token work. `/docs/` did not exist before this audit |

---

## 14. CSS / design-system audit

`src/styles/global.css` (310 lines) defines a real token system — colours, typography, spacing, radii, shadows — and `REFACTORING_REPORT.md` records the migration at "60–65% complete". That assessment matches what is measurable:

| Metric | Value |
|---|---:|
| CSS files | 68 |
| Total CSS lines | 6,667 |
| `var(--token)` usages | 4,377 |
| **Hard-coded hex colours remaining** | **2,438 (36%)** |
| `@media` queries | 208 |
| **…that are `max-width` (desktop-first)** | **~205 (99%)** |
| Distinct breakpoints in use | 16 (420, 440, 480, 600, 640, 650, 700, 800, 850, 900, 950, 980, 1000, 1050, 1100, 1200) |

**C-1 — The entire responsive layer is desktop-first.** This is the direct opposite of the brief's mandated MOBILE → TABLET → LAPTOP → DESKTOP progression. Converting 205 media queries is significant work and must be planned, not attempted opportunistically.

**C-2 — No breakpoint system.** Sixteen ad-hoc breakpoints, several one-offs (`420px`, `1050px`). There are no breakpoint tokens (and CSS custom properties cannot be used in media queries, so this needs a build-time or convention-based solution).

**C-3 — Typography scale is unusable as-is.** See A11Y-2. `--font-size-xs: 8px` through `--font-size-base: 11px` should not exist at those values. The scale also has 19 steps (`xs` … `14xl`, `display-*`), which is far more granularity than a design system needs and encourages inconsistency rather than preventing it.

**C-4 — Token adoption is incomplete and being actively undermined** by the injected `<style>` blocks and `marketplace-polish.css`, both of which hard-code colours.

**C-5 — Bootstrap is imported for four dropdowns.** Full CSS + JS bundle. Either use Bootstrap properly across the app or replace those four dropdowns and drop the dependency.

---

## 15. Consolidated classification

### KEEP (correct, useful, maintainable — preserve and build on)
- Three-app route separation and layout shells (`PublicLayout`, `AdminLayout`, `SellerLayout`)
- Lazy loading of admin and seller chunks
- `ExplorePage` faceted filtering — the reference implementation for search/browse
- `ComparisonContext` + `useComparison` + `ComparePage`
- `AdminComponents` (`Heading`, `Kpis`, `Filters`, `Table`) and `AdminStates`
- `PageStates` (`LoadingState`, `EmptyState`, `ErrorState`, `PageErrorBoundary`)
- `components/Icon.jsx`, `components/SEOHead.jsx` (shape is right; lifecycle needs fixing)
- `OrderConfirmationPage`'s honest "unavailable" pattern
- `data/termsContent.js` — genuine, substantial legal content
- The design-token concept in `styles/global.css`
- `.github/instructions/frontend-quality.instructions.md` — a good, already-correct standard

### IMPROVE
- Token adoption (36% of colours still hard-coded)
- Breakpoint system and mobile-first conversion
- Typography scale (values and step count)
- Header/Footer chrome mechanism (works, but remove the redundant per-page renders)
- Image handling (formats, sizes, `srcset`, lazy-loading)
- Public seller, brand, guide and category pages (thin content)

### FIX
- 434 dead buttons, 113 dead selects, 182 unwired inputs
- Rating/Recommended sort (`NaN` comparator) in Search and Categories
- Brand facet derived from `name.split(' ')[0]`
- `Header` `isLoggedIn` default of `true`
- Header nav category dropdown that never navigates
- `/explore?need=` and `?budget=` parameters ignored
- `SEOHead` metadata leaking between routes; `/404` canonical and `index,follow`
- Inverted index/noindex policy
- `apple-iphone-15` inverted price and false `-30%` badge
- Cart lost on refresh
- Fake pagination in admin, seller and deals
- Admin app has no 404
- Static `fa-toggle` "switches"
- Favicon MIME/format mismatch

### REFACTOR
- 21 duplicated `FaIcon` declarations → shared `Icon`
- 6 duplicated money-parsing helpers → one utility
- `<style>` blocks in `AdminPage.jsx` / `AdminSystemLogs.jsx` → CSS files
- `marketplace-polish.css` overrides → merged into owning stylesheets
- `AccountShell` text-matching router → explicit props/routes
- `navigation.js` module-level navigate → router-native navigation
- `seller/pages/Dashboard.jsx` re-export → import the real file
- Single-line mega-JSX → readable formatting

### REPLACE
- `data/mockData.js` and `data/sellerMockData.js` → typed models from a real API
- `auth.js` → real session handling against a real auth service
- All dashboard/analytics data → real aggregates
- Price/rating string types → numeric types

### REMOVE (after verifying references)
- `src/BlogPage.jsx`, `src/ExploreDiscoverySections.jsx`
- `/blog` route (redundant with `/guides`)
- One of `/returns` vs `/returns-refunds`
- `dist.zip`
- Fabricated content listed in §7 (competitor brand names, testimonials, "50,000+ shoppers", fake bank/tax/2FA state, fake backup/integration data)
- Bootstrap, if the four dropdowns are reimplemented

### MISSING (must be built)
- Node.js + Express backend
- MySQL 8 / InnoDB schema and migrations
- Authentication, session/token handling, RBAC
- Server-side seller ownership enforcement
- Server-controlled cart and transactional order creation
- Payment abstraction, shipping abstraction
- Returns/refunds workflow
- Notification abstraction
- Real analytics aggregation
- AI pipeline (intent → structured criteria → grounded search → ranking → explanation)
- `robots.txt`, `sitemap.xml`, and an SSR/prerender decision
- Automated tests of any kind
- `/docs/ARCHITECTURE.md`, `API.md`, `DATABASE.md`, `SECURITY.md`, `SEO.md`, `AI.md`, `DEPLOYMENT.md`, `TESTING.md`, `ADMIN.md`, `SELLER.md`

---

## 16. Recommendation on the phase plan

The brief's 20-phase order was written on the assumption that a backend exists. It does not. Phases 1–6 (content, interactions, UI, components, admin, seller) all end at the same wall: **you cannot remove fake data from a dashboard until there is real data to put there**, and you cannot make a Place Order button work without an order service.

I am not proposing to change the phase list — that is your call. I am flagging the dependency so the sequencing decision is made deliberately:

**Option A — follow the brief literally.** Phases 1–6 polish the front-end while it remains mock-driven. Risk: much of that work is redone when the API lands, and the "no fake data" rules in Golden Rules 21–24 cannot actually be satisfied until Phase 7–9.

**Option B (recommended) — pull the foundation forward.** Insert a **Phase 0.5** before Phase 1 covering only: database schema, Express skeleton, auth + RBAC, and the products/categories/sellers read endpoints. Then Phases 1–6 proceed against real data and satisfy the brief's rules as written. This front-loads Phases 7, 8 and part of 9.

**Option C — split the difference.** Do the low-risk, backend-independent work first (image optimisation, mobile-first CSS, dead-button removal, SEO meta fixes, accessibility), then the backend, then the data-dependent phases.

Three items are worth doing immediately under any option, because they are cheap, self-contained and currently harmful:

1. **Image optimisation** — ~19 MB → a realistic target of under 1 MB. No architectural dependency.
2. **`SEOHead` lifecycle fix + `robots.txt`** — stops wrong canonicals and stops admin routes advertising themselves as indexable.
3. **Remove fabricated security/financial/operational claims** (S-5, S-6, and the checkout PII) — these are the items most likely to mislead a real person.

---

## 17. What this audit did not cover

Stated plainly so the gaps are known:

- **Colour contrast was not measured** systematically, and no screen-reader pass was performed.
- **Not every one of the 224 routes was individually opened.** Roughly 40 representative routes were visited live; the remaining admin/seller routes were audited from source and from sidebar-to-route mapping.
- **No load, stress or Lighthouse scoring** was run — bundle and asset sizes were measured directly from the build output instead.
- **Deployment configuration was not reviewed** because none exists in the repo (no `vercel.json`, no CI workflow, no Dockerfile).
- **The sibling folder `D:\GitHub Projects\ai-shopping-marketplace`** was checked in case it held the Mirwal backend. It does not — it is a separate, unrelated TypeScript skeleton (9 files: env, db, auth, catalog, embedding, text) with no routes or controllers. There is no backend for Mirwal anywhere on this machine that I could find.

---

## 18. Phase 0 stop

The audit is complete and no application code was modified.

**Awaiting your approval before starting Phase 1**, and — more importantly — your decision on the sequencing question in §16, since it determines what Phase 1 can actually deliver.

---

## 19. Post-audit remediation (27 August 2026)

Approved after Phase 0 as the three backend-independent items from §16. Verified with `eslint`
(0 findings), `vite build` (passes), and a live 23-route pass in the browser (no error states,
no horizontal overflow at 375px or desktop).

### 19.1 Image optimisation — resolves §11

| | Before | After |
|---|---:|---:|
| Image payload | 19,973 KB | **815 KB** (−95.9%) |
| Total `dist/` | 20 MB | **3.1 MB** |
| Header logo (every page) | 391 KB | **11 KB** |
| Home hero (4 banners) | ~6,900 KB | **358 KB** |

- Photographic art and illustrations converted to WebP, resized to the largest size actually
  rendered. Brand logos stay PNG so the brand mark cannot fail to render.
- Assets renamed from generator output (`ChatGPT Image Aug 23, 2026, 08_44_29 PM.png`) to
  descriptive kebab-case.
- `public/mirwal-symbol-logo.png` (950 KB, referenced by nothing) moved out of `public/` so it
  no longer ships; it is now the source for the generated favicons.
- Favicon MIME/format mismatch fixed — was declared `image/svg+xml` pointing at a PNG. Now a
  proper 32/192 + apple-touch-icon set.
- Hero image marked `fetchpriority="high"` with explicit dimensions (LCP).
- Repeatable via `npm run optimize:images` (`scripts/optimize-images.mjs`).

### 19.2 SEO metadata — resolves the §10 leak, robots policy and missing infrastructure

- **New:** `src/seo/applyMeta.js` is the single writer for per-route `<head>` state. Every field
  is written on every call and an empty field removes its tag, which is what stops leaking.
- **New:** `src/seo/routeMeta.js` holds the crawl policy and per-route titles/descriptions.
- **New:** `src/components/RouteMeta.jsx`, rendered before `<Routes>` so a page's own `<SEOHead>`
  effect runs afterwards and its more specific values win.
- `SEOHead` rewritten to always write a complete set; `canonical={null}` marks non-canonical pages.
- `NotFoundPage` now declares its own `noindex` — `RouteMeta` cannot tell an unmatched path from
  a valid dynamic route.
- **New:** `public/robots.txt` and a generated `public/sitemap.xml` (63 URLs), wired to `prebuild`.
- **New:** `.env.example` documenting `SITE_URL` / `VITE_SITE_URL` / `VITE_API_BASE_URL`.
- Removed the `meta keywords` tag (ignored by search engines since ~2009).

Verified before → after:

| Route | Before | After |
|---|---|---|
| `/404` | title of previous page, `canonical=/shipping`, `index,follow` | `Page not found`, no canonical, `noindex,follow` |
| `/admin/*` (91) | previous page's title, `canonical=/shipping`, `index,follow` | `Admin`, no canonical, `noindex,nofollow` |
| `/seller/*` panel (75) | as above | `Seller Centre`, no canonical, `noindex,nofollow` |
| `/sellers`, `/brands`, `/guides` | `noindex,follow` | `index,follow`, self-canonical |
| `/about`, `/help-center`, `/sell-with-mirwal`, `/products` | inherited title + wrong canonical | own title, description, self-canonical |
| `/cart`, `/login`, `/search` | inconsistent | own title, no canonical, `noindex` |

### 19.3 Fabricated claims removed — resolves S-4, S-5, part of S-6, and §7

| Location | Removed | Replaced with |
|---|---|---|
| `Header.jsx` | `isLoggedIn = true` default; stock avatar; the name "Umar" shown to every visitor | Real session state; initial-based avatar; signed-out visitors now see **Sign In** |
| `CheckoutPage.jsx` | Pre-filled PII (`Awais Ahmed`, `+92 300 1234567`, email, street address, city, postcode) | Empty fields with placeholders and correct `autoComplete` |
| `CheckoutPage.jsx` | "256-bit encrypted"; "Total (VAT incl.)" | Honest wording; "Total" (no tax is calculated) |
| `CartPage.jsx` | Hard-coded "Color: Black" and a `-20%` fallback badge; "VAT incl." | Removed |
| `ProductPage.jsx` | "Only 8 items left!" on every product | Removed |
| `ProductPage.jsx` | "Your review was added successfully" / "Your question was sent to the seller" | Messages that state the action was **not** published or sent |
| `AuthPage.jsx` | "Join 50,000+ happy shoppers"; "100% protected"; "100% Secure" | Claims Mirwal can actually stand behind |
| `HomePage.jsx` | **Daraz, PriceOye, Telemart** listed as "Verified" Mirwal stores | Brands derived from the real catalogue; the fake store grid is hidden |
| `HomePage.jsx` / `mockData.js` | Three invented testimonials with stock portraits | `reviews` emptied; the section hides itself |
| `AboutUsPage.jsx` | Four invented executives (Founder & CEO etc.) with stock portraits | `team` emptied; the section hides itself |
| `FinancePage.jsx` | Meezan Bank account, IBAN `PK36 MEZN…`, `NTN-1234567` | "No payout method added yet"; empty fields |
| `FinancePage.jsx` | "Two-factor authentication: **Enabled**", "Email verification: **Verified**" | "Not available yet" — security state is never hard-coded |
| `AdminDashboard.jsx` | Six services reported "Operational" with a green tick | "Not monitored" |
| `mockData.js` | `apple-iphone-15` price/old transposed, advertising a **price rise** as `-30%` | Corrected pair; all 35 products now pass price/badge validation |

### 19.4 Deliberately deferred

- **Admin backup / maintenance screens** (`AdminPage.jsx`) still show fabricated backups to
  "Google Drive" / "Amazon S3" and maintenance IP allow-lists. These are whole fictional screens
  for features that do not exist; rewriting them belongs to Phase 5, not to a content pass.
- **Account pages** (`AssistantRelatedPage.jsx`) still carry a demo identity ("Muhammad Umar",
  phone, address, order history). Unreachable today (requires a customer session that cannot be
  created) and superseded once auth exists.
- **Bootstrap removal.** Measured during this pass: the real dependency is ~4 dropdowns, ~35
  `btn` classes and one `form-check-input`. No grid, no tabs, no cards. Dropping it would save
  roughly **310 KB** (Bootstrap CSS ~232 KB + JS bundle ~80 KB) for modest rework — a strong
  Phase 3/4 candidate. The main JS chunk (664 KB) and CSS bundle (595 KB) remain the largest
  payloads now that images are handled.

### 19.5 Needs your input

- **`SITE_URL` is a guess.** `robots.txt`, `sitemap.xml` and all canonical URLs currently use
  `https://mirwal.com`. Set the real production domain in `.env` before deploying.
- ~~**`/seller/*` is shared** by the seller panel and public storefronts...~~ **Resolved** — see
  §21 "`/seller/*` route collision — resolved". The seller panel now lives at `/seller-center/*`;
  the public storefront keeps `/seller/:sellerSlug`.
- **`sharp`** was added as a devDependency for the image pipeline. It is build-time only and
  ships nothing to the browser.

---

## 20. Phase 0.5 — backend foundation (27 August 2026)

Local MariaDB **10.11.16** (exact production build) runs from `D:\mirwal-devdb` — portable
ZIP, SHA256 verified, no Windows service, no system-wide install. Its server default is set
to **latin1 on purpose**, mirroring production, so a migration that omits an explicit
`utf8mb4` fails locally instead of silently corrupting data in production.

**Database** — 2 migrations, 15 tables, 18 FKs, 0 non-utf8mb4 text columns, reproducible
from zero (`migrate fresh`). 18 constraint tests pass. Highlights:

- `products.seller_id NOT NULL` — ownership, which existed nowhere in the frontend model.
- `CHECK (compare_at_price > price)` — the inverted-price bug is now unrepresentable.
- SKU unique **per seller**, not globally (verified two stores can both use `SKU-001`).
- `DATETIME(3)` UTC throughout (10.11's `TIMESTAMP` overflows in 2038).

**API** — Express + mysql2 + zod, all pure JS so it installs on cPanel without a compiler.
Passwords use Node's built-in scrypt for the same reason. Endpoints in `docs/API.md`.

**Security** — 12/12 authorization boundary tests pass, including forged `alg: none` JWT
rejected and refresh-token replay revoking all sessions. Seller A (18 products) and
Seller B (17) have zero overlap. Error responses carry only `code`, `message`, `requestId` —
checked for stack, SQL, driver-code and path leakage.

**Still blocked:** production deployment. `lower_case_table_names`, `sql_mode`, existing
tables and the `REFERENCES` privilege remain unverified — see `docs/DATABASE.md` §2.

---

## 21. Phase 1 — connecting the frontend to real data (in progress)

Content could not be made "correct" cosmetically while every value was a literal in the
bundle, so Phase 1 began by replacing the data source.

### Done

| Area | Change |
|---|---|
| `services/apiClient.js` (new) | Envelope handling, typed `ApiError`, transparent refresh-on-401. **Access token held in memory, not localStorage** — the audit's critical finding. Session restored by asking the server, never by reading local state. |
| `services/api.js` | Rewritten from an unwired draft to the endpoints that actually exist. |
| `hooks/useApiQuery.js` (new) | Loading/error/empty states. **Deliberately does not fall back to mock data on failure** — that would present seed data as live. |
| `lib/money.js` (new) | Integer minor units. Replaces `parseInt(price.replace(/\D/g,''))` reimplemented in six files. |
| `ProductsPage` | API-backed, real pagination, own SEO identity. H1 was "Explore", duplicating `/explore`; now "All Products". |
| `ProductPage` | Fully API-backed. Removed: hard-coded Black/Silver/Rose Gold/Blue swatches, "Only 8 items left!", "1 Year warranty", "Sold by Awais Store", a review summary quoting 1.2k reviews above an empty list, and a Q&A form that reported success and sent nothing. Product schema now emits real `offers`, and `aggregateRating` only when real reviews exist. |
| `CartPage`, `CheckoutPage`, `MirwalModals` | Consume canonical cart items; no display-string parsing left. |
| `eslint.config.js` | Split into frontend (browser) and backend (Node) sections. |

### Bugs found and fixed during this phase

1. **Double-discounted cart total.** Subtotal was built from the already-discounted price
   and the saving was then subtracted again — Rs. 164,990 − Rs. 30,000 = Rs. 134,990. The
   mock data hid this because its savings were mostly zero. Subtotal is now the pre-discount
   list total: Rs. 194,990 − Rs. 30,000 = Rs. 164,990.
2. **Cart showed every line as a Rs. 0 saving** because `compareAtPrice` was not passed
   through to the cart item.
3. **Currency formatting mismatch** — API emitted `Rs 202,000`, frontend `Rs. 202,000`.

### ExplorePage — converted

The most complete faceted UI in the app now filters, sorts and paginates **in the database**.
To avoid dropping working functionality, two facets were added to the API rather than removed
from the UI: `type` (filters on `products.subtitle`) and `minDiscount` (which also powers
the "On sale" facet as `minDiscount >= 1`). A new `GET /products/facets` supplies category,
brand and type values **with counts, from live data** — Explore previously derived brands from
a hard-coded array and types from a mock field, so some filter options matched nothing.

Facet URLs still accept user-facing names (`?category=Electronics`) and map them to slugs, so
existing links and the header's category menu keep working.

Verified against the API directly and through the UI — identical counts in both:

| Filter | Result |
|---|---|
| `?category=Electronics` | 19 products, H1 becomes "Electronics" |
| `?type=Laptop` | 4 |
| `?discount=20` | 6 |
| `?maxPrice=30000` | 13 |
| `?search=laptop` | 5 (InnoDB FULLTEXT) |
| `?category=Electronics&maxPrice=40000` | 5 |
| `sort=Price: Low to High` | Rs. 5,999 → 6,499 → 8,499 |

Also removed while converting:

- **"Verified marketplace seller"** asserted on every product card. Mirwal has no seller
  verification process; sellers are `approved`, which is a different claim. Cards now show
  the real store name.
- The "Sponsored" slots, which were a slice of the local array. There is no sponsorship in the
  data model, so the feature is gone rather than faked.
- The empty `Automotive` category no longer appears as a facet at all — `/products/facets`
  returns only categories that have live products, which resolves audit finding D-4.

### CategoriesPage — converted

Landing grid now comes from `GET /categories` (real per-category `productCount`, no more
recomputing a filter over a local array), and the detail view comes from `GET /categories/:slug`
plus `GET /products?category=slug` with server-side filter/sort — the same pattern as
`ProductsPage`.

Removed rather than carried forward:

- The hard-coded `descriptions` / `subcategories` maps keyed by category name. `subcategories`
  in particular rendered as if it were real taxonomy, but was an arbitrary fixed string list
  with no product-count backing — it just linked into `/explore?search=...`. The categories
  table has no populated hierarchy yet (`children` is always empty in current seed data), so
  there is nothing honest to show here; the section is simply absent rather than faked. It can
  come back once categories are seeded with real parent/child relationships.
- A special case that turned the unlinked slug `mobile-phones` into a fabricated "Mobile
  Phones" category (filtering products by `type === 'Smartphone'`). No page anywhere links to
  `/categories/mobile-phones`; an unknown slug now correctly 404s via the category API instead.
- The multi-select compare picker (a checkbox on every card feeding a sticky `CompareBar`).
  `ComparisonProvider` stores whatever object is passed to `addProduct` verbatim, and
  `ComparePage` (not yet converted) renders `product.price` as a bare string — the API's
  `product.price` is `{amount, currency, display}`, which React cannot render as a child and
  would crash the page. `ExplorePage` hit the identical conflict and resolved it by linking to
  `/compare?product=slug` instead of adding the live object to the shared context; this
  conversion follows that precedent so compare stays functional for the still-mock pages
  without exposing a real product to a page that can't render its shape yet.

Verified in the browser against the local API: `/categories` lists all 7 seeded categories with
live counts (Electronics 19 … Automotive 0); `/categories/electronics` lists all 19 products,
sort (`price-low`) and the filter box (server-side `q`) both narrow correctly; `/categories/automotive`
(a real, empty category) renders the honest empty state instead of an error; an unseeded slug
(`/categories/not-a-real-category`) renders the real 404 page. No console errors other than the
expected 404 response from that last deliberate test.

### SearchResultsPage — converted

Same listing query as Explore/Categories, scoped to a free-text `q`. Brand options and the
price-slider ceiling now come from `GET /products/facets` instead of being derived from the
mock array (`[...new Set(products.map(p => p.name.split(' ')[0]))]`) or a fixed 350,000 cap.

Found and fixed in passing, independent of the mock-data conversion: **this page rendered its
own `<Header>`/`<Footer>`** while already being mounted under `App.jsx`'s `PublicLayout`, which
renders both `global` — every visit to `/search` showed two headers and two footers. Every
other page under that layout (Categories, Explore, Products) renders only its `<main>`; this
now matches them.

The "Try these related products" suggestions, previously a loose client-side match against the
mock array, now query real popular products (`sort=rating`) and only render when the search
genuinely returns zero results, so they can't imply a match that isn't there. "Load more"
(which re-sliced an already-fully-fetched local array) is replaced with the same Previous/Next
pagination as `ProductsPage`, since filtering and paging now happen in the database.

Verified in the browser against the local API: `?q=laptop` returns 5 products with a working
sort; `?q=zzzznoresult` shows the honest empty state plus 5 real popular-product suggestions,
not fabricated matches; filtering by brand (`Apple`) on an empty query narrows correctly to 2
products; `read_page` on `/search` shows exactly one header nav and one search form, confirming
the duplicate-chrome bug is gone.

### ComparePage — converted

This was the actual reason `ExplorePage`, `CategoriesPage` and `SearchResultsPage` all link to
`/compare?product=slug` instead of adding a live product to the shared comparison context: this
page rendered `product.price` as a bare string, and the API's `product.price` is
`{amount, currency, display}` — an object React cannot render as a child. That crash risk is
what this conversion removes, so those three pages' compare links now resolve to a real product
instead of a dead end.

Also found and fixed in passing: **another instance of the duplicate-chrome bug** — this page
rendered its own `<Header>`/`<Footer>` while mounted under `PublicLayout`, which already
supplies both `global` (the same issue fixed in `SearchResultsPage`). And removed:

- `compareImages`, a hand-picked Unsplash URL hard-coded for four specific mock product ids,
  worked around missing images in the mock data. Real product images don't need it.
- `Brand` in the feature table was guessed from the product name (`name.split(' ')[0]`);
  `Availability` was a fixed "Check product page" placeholder. Both are real fields on the API
  product (`product.brand.name`, `product.availability.inStock`/`lowStock`) now.
- The sidebar product picker and the URL-driven auto-add (`?product=slug` /
  `?products=slug,slug`) both queried the mock `products` array; both now call the catalog API
  (`api.products.list` for the picker's search, `api.products.get` for each slug in the URL).

The comparison context's sessionStorage key was bumped (`mirwal-comparison` →
`mirwal-comparison-v2`) — a v1 entry left over from before this conversion would be mock-shaped
and would hit the same rendering crash on load. See `components/ComparisonContext.jsx`.

Verified in the browser: `/compare?product=apple-iphone-15` resolves the slug via the API and
renders it (title becomes "Compare Apple iPhone 15 (128GB) | Mirwal"); adding a second product
from the sidebar picker renders a correct two-column feature table with real brand, rating,
availability and seller values and no console error; clicking "Add to Cart" on an API-shaped
product from both the card and the feature table produces no error (the exact path that used to
be unsafe); `read_page` shows exactly one header nav, confirming the duplicate-chrome fix.

### HomePage — converted

The highest-traffic page, and the one with the most outright fabricated content found so far.
Removed rather than reshaped onto real data, because no real source exists for any of it:

- **`Stats`** — "50K+ Happy Customers", "2,000+ Trusted Stores", "100K+ Products Compared",
  "98% Positive Reviews". No metrics endpoint exists to source real figures from, and there is
  no honest smaller number to put there instead — the claim itself has no backing, so the
  section is gone.
- **`Reviews`** — pulled from `mockData.reviews`, which earlier Phase 0 remediation had already
  set to `[]` for the same reason (fabricated testimonials). The section already rendered
  nothing (`if (!reviews.length) return null`); the dead component and the mock import are now
  gone too.
- **`Stores()`** — a no-op placeholder (`return null`), removed along with its call site.

Reshaped onto real data:

- **`ComparePreview`** compared two hard-coded product indices and asserted invented per-row
  verdicts — `Best for: "Creative work"` vs `"Everyday productivity"`, `Value: "More power"` vs
  `"Lower starting price"` — regardless of what those two products actually were. It now
  compares two real top-rated products on fields that are actually true of them: price, rating,
  brand, category.
- **`RecommendedPicks`** attached a fixed persona label to whatever mock product happened to
  sit at that array index (`"Best for creators"` on `products[2]`, unconditionally). The reason
  shown per pick is now computed from that product's real data — its actual discount percentage,
  or its actual rating and review count.
- **`popularBrands`** and **`Categories`** now come from `GET /products/facets` and
  `GET /categories` (real names, real per-category counts) instead of a derived-from-mock array
  and a hard-coded category list.
- Every `ProductSection` (Top Picks, Trending, Home & Lifestyle Favorites, More Products)
  now loads its own live slice of real, in-stock-aware products via a small `ApiProductSection`
  wrapper, instead of slicing one local mock array five different ways.
- The shared `ProductCard`'s Add to Cart button is now disabled with an "Out of stock" label
  when the product actually has none — previously unconditional, so it was possible to add an
  out-of-stock product to the cart from the homepage (the same class of bug fixed in
  `ComparePage`'s card during that conversion).
- `mirwal-recent-products` (the "Continue Shopping" localStorage key) now stores product
  **slugs**, and "Continue Shopping" hydrates them via `api.products.get(slug)` — previously it
  stored the mock numeric id and looked products up in the mock array, which would not resolve
  against real API products going forward.

Decorative-only images (the "Shop Your Way", "What are you shopping for?" and "Shop by Budget"
tiles never claimed to represent a specific product — they're navigation shortcuts) now draw
from one shared pool of real, live products fetched once, rather than picking specific indices
out of the mock array.

Verified in the browser: homepage renders all sections with real data, zero console errors,
and the network log shows all 9 homepage API calls (`facets`, `categories`, and 7 product
list/detail queries) resolving `200 OK`. "Home & Lifestyle Favorites" correctly resolves the
category slug `home-and-living` (confirmed against the live API — not `home-living`, which
`slugify('Home & Living')` might suggest). The iPhone (seeded with zero stock) correctly shows
"Out of stock" with its Add to Cart button disabled everywhere it appears on the page.

### DiscoveryPage — converted

This component also had a `type="categories"` mode, but no route in `App.jsx` ever passes it —
`CategoriesPage` owns `/categories`. That branch was dead code and is now gone; the component is
brand-only, matching its only real routes (`/brands`, `/brands/:slug`, `/brand/:brandSlug`,
`/brand/:brandSlug/:categorySlug`).

Brand data now comes from `GET /brands` (real name, real per-brand product count via
`b.logo_url`/`COUNT`). The mock version derived a brand list by taking the first word of every
product name (`[...new Set(products.map(p => p.name.split(' ')[0]))]`) and borrowed a matching
product's photo as the brand's image — which is why "La" and "New" showed up as brand names in
the dev catalogue (from "La Roche-Posay..." and "New Balance..."). The real `brands` table has
none of that noise. Brand logos are real (`brand.logoUrl`) rather than a borrowed product photo;
the dev seed hasn't set any yet, so a brand card without one just shows the icon instead of a
fabricated stand-in.

Also fixed: **another instance of the duplicate-chrome bug** (own `<Header>`/`<Footer>` under
`PublicLayout`, which already renders both) — the fourth page found with this issue after
Search, Compare, and (about to be found again in) ProductListingPage.

Verified in the browser: `/brands` lists 30 real brands with real counts; `/brand/apple`
resolves 2 real Apple products with working category shortcuts and a related-brands rail;
`/brand/not-a-real-brand` renders the real 404 page.

### ProductListingPage — converted

Backs `/new-arrivals` and `/featured`, both previously filtered from the mock array on fields
that don't mean what they claimed: "New Arrivals" showed `badge === 'New'` OR "one of the last
10 items in the array" — an accident of array order, not recency. "Featured" showed
`badge || rating >= 4.7` — `badge` doesn't exist on a real product. Both are real catalog sorts
now: `sort=newest` for New Arrivals (a real `published_at` ordering), `sort=rating` with a real
`rating >= 4.5` floor for Featured. Category filter comes from `GET /categories` instead of
`[...new Set(sourceProducts.map(p => p.category))]`. Also fixed the same duplicate-chrome bug
(own `<Header>`/`<Footer>` under `PublicLayout`).

Verified in the browser: `/new-arrivals` returns 35 products sorted newest-first, including
correctly-disabled "Out of stock" buttons on zero-stock items; `/featured` returns 30 products,
all genuinely rated ≥ 4.5, sorted by rating.

### DealsPage / DealPage — converted

`DealsPage` had the most outright-fabricated UI found in this pass:

- **"Showing 1 - N of 2,350 deals"** and a **"1 2 3 4 5 ... 523"** page list — invented numbers
  unrelated to `shownProducts.length`, which was sitting right next to them. Real pagination
  totals now (the dev catalogue currently has 26 discounted products).
- **Every sidebar filter checkbox** (categories, discount tiers, brands) had a hard-coded count
  and no `onChange` at all — it looked interactive and did nothing. Discount tiers and brands
  are now real, functional, single/multi-select filters against the live query; the category
  checkbox list was replaced by the same real category pills already at the top of the page
  (having both was redundant). A non-functional price-range slider with hard-coded bounds
  (Rs. 500–250,000) was removed rather than reimplemented, since it filtered nothing before.
- **A static countdown clock** ("02 : 41 : 18") next to the hero banner — false urgency with no
  real offer-expiry data behind it anywhere in the schema. Removed.
- `dealCategories` mapped "Mobiles"/"Laptops" to a mock `product.type` field that doesn't exist
  on a real product; category filtering is real category slugs now.

`DealPage` (`/deals/:dealSlug`) now resolves the slug via `GET /products/:slug` and treats a
product with no `compareAtPrice` as not-a-deal — same 404 as an unknown slug, rather than
`products.find(p => p.id === slug && p.old)` against the mock array.

Also fixed: **a fifth instance of the duplicate-chrome bug** (`DealsPage` rendered its own
`<Header>`/`<Footer>` under `PublicLayout`, which already renders both).

**Bug found and fixed in the shared catalog query, independent of this page's conversion:**
`minDiscount` filtered on the *unrounded* discount fraction while `discountPercent` (what every
page displays) is `Math.round()`-ed. Samsung Galaxy Watch 6 is a true 29.69% discount, shown
everywhere as "30% OFF" — but a "30% and above" filter excluded it, because 29.69 is less than
30. Fixed in `catalog.service.js`'s `listProducts()` by rounding inside the SQL comparison
(`ROUND((compare_at_price - price) / compare_at_price * 100) >= ?`) so the filter agrees with
the number shown next to it. This affects every `minDiscount` consumer — Explore's discount
checkboxes and "On sale" facet, and Deals' discount tiers — not just this page.

Verified in the browser: `/deals` shows "Showing 1 - 24 of 26 deals" (real); clicking the
Electronics pill narrows to 13; combining Electronics + "30% and above" now correctly returns
exactly 1 result (Samsung Galaxy Watch 6) instead of 0, confirmed via direct API calls before
and after the fix; `/deals/samsung-galaxy-watch-6` renders the real deal; `/deals/macbook-air-m3`
(a real product with no discount) correctly 404s as "not a deal."

### `/seller/*` route collision — resolved (S19.5)

Before converting `SellerPages`, the deferred route-collision decision from S19.5 had to be
made: the seller management panel and the public seller storefront both lived under `/seller/*`,
and React Router's static-beats-dynamic ranking meant any real seller whose slug matched one of
14 reserved words (`products`, `orders`, `finance`, `store`, `help`, `support`, `marketing`,
`reviews`, `customers`, `categories`, `brands`, `notifications`, `earnings`, `withdrawals`,
`coupons`) would have their storefront silently shadowed by the panel. This was undetectable
before now because the mock storefront only ever had one hard-coded seller.

Presented to the user as a real architectural decision (move the panel, move the storefront, or
defer). **Decision: move the seller panel to `/seller-center/*`**, keeping the public storefront
at the shorter, more shareable `/seller/:sellerSlug` — panel URLs are navigated in-app by logged-in
sellers and were never indexed or bookmarked externally (`noindex,nofollow` throughout), so they're
the lower-cost side to rename.

Changed:
- `App.jsx` — all ~75 seller-panel `<Route>` declarations moved from `/seller/...` to
  `/seller-center/...`; added `<Route path="/seller" element={<Navigate to="/seller-center" replace />} />`
  for old bookmarks of the panel root. Deep panel links (`/seller/products`, `/seller/orders`, ...)
  do **not** redirect — nothing external should have linked to noindex,nofollow panel pages, and
  those paths are now legitimately available for real seller storefront slugs.
- `SellerRouteLayout`'s active-nav-item logic and breadcrumb "Dashboard" link updated to match.
- `seo/routeMeta.js` — removed `SELLER_PANEL_SEGMENTS` / `isSellerPanel()`, the workaround that
  had to guess whether a `/seller/:x` path was a panel segment or a real storefront slug for SEO
  purposes. With the panel moved, `/seller-center` is unambiguous and `/seller/:slug` now falls
  through cleanly to the same indexable-dynamic-route default every other public storefront gets.
- `admin/AdminProducts.jsx` — updated a cross-reference string that redirects a shared
  "Add Product" action from `/seller/products/add` to `/admin/products/new` when rendered in the
  admin context; the sentinel string it matches against had to move too.
- All ~118 internal route references across 18 files under `src/seller/` (sidebar nav, headers,
  breadcrumbs, per-page navigation) — delegated to a subagent given the volume, verified against
  lint and a full build afterward.

Verified in the browser: `/seller` redirects to `/seller-center`, which (unauthenticated)
correctly falls through `RequireRole` to `/login`. `/seller/products` — the exact string that
used to silently show the panel's Products page — now correctly 404s as "no seller named
'products'" instead, which is the bug fixed, made visible. `/sellers` lists both real dev
sellers with real product counts and cities; `/seller/dev-store-alpha` shows exactly Dev Store
Alpha's 18 products; `/seller/dev-store-alpha/electronics` correctly narrows to that seller's 10
Electronics products (seller isolation holding, same as the backend authorization tests from
Phase 0.5).

**Noted, not fixed:** `App.jsx` also has a separate, single-seller `/store` route (`StorePage`),
unrelated to per-seller storefronts and outside today's scope — worth a look whenever
`StorePage`/`AwaisStorePage` come up in the mockData conversion pass, since `/stores/awais-store`
suggests it may have the same one-hard-coded-seller pattern `SellerPages` just moved past.

### SellerPages — converted

Backed by the same catalog endpoints already used elsewhere: `GET /sellers` for the listing,
`GET /sellers/:slug` + `GET /products?seller=slug&category=...` for a storefront. The mock
version had exactly one hard-coded seller (`sellerMockData.sellerStore`) — the listing always
read "1 seller available" regardless of `sellerStore`'s actual content, and any `sellerSlug`
other than that fixed value 404'd immediately, so multi-seller behavior was never really
exercised. Two real sellers exist now, and their catalogs are genuinely isolated by
`seller_id` — a change that only became observable once there was a second seller to check
against.

Category navigation now comes from `GET /categories` (real, sitewide) rather than deriving the
unique set from the seller's own products; a category with none of this seller's products just
shows the existing honest empty state rather than being fabricated or omitted. Real pagination
(`GET /products` `pagination`) replaces loading every seller product into memory at once, which
is also what makes the per-category counts on the storefront actually correct instead of a
client-side re-count of an unbounded local array.

### Correction — the "duplicate-chrome bug" was not actually visible

Every "another instance of the duplicate-chrome bug" claim in this section (`SearchResultsPage`,
`ComparePage`, `DiscoveryPage`, `ProductListingPage`, `DealsPage`, and `AccountShell` just below)
overstated what was actually happening. `components/Header.jsx` and `components/Footer.jsx` both
already self-suppress: `const chromeIsMounted = useContext(SiteChromeContext); if
(chromeIsMounted && !global) return null`. `PublicLayout` sets that context to `true` around its
`<Outlet/>`, so a page rendering its own bare `<Header>`/`<Footer>` (no `global` prop) while
already nested inside `PublicLayout` was never actually drawing a second header or footer — the
nested call returned `null`. There was no visible bug, and the "exactly one header" verification
in each of those sections was real but did not demonstrate what it was credited with fixing: it
would have shown exactly one header either way, guard or no guard.

Removing the dead calls was still worth doing — they mounted an extra component that immediately
returned null on every render, and their presence wrongly implied those pages managed their own
chrome, which is a real "which pattern do I copy" trap for whoever edits one of them next
expecting `<Header>` to do something. But it should have been reported as dead-code cleanup, not
a bug fix, and I should have read `Header.jsx` before writing "duplicate-chrome bug" the first
time rather than pattern-matching from the JSX alone. Recorded here rather than silently
rewriting the earlier claims, so the correction is visible in the log the same way the finding
was.

### Security finding — frontend route guards trust localStorage, not the server

Found while converting `AccountUtilityPage`, whose `Logout` button did not call the real
`api.auth.logout()`. Tracing why led to `src/auth.js`: `RequireRole` (guarding `/admin/*` and
`/seller-center/*`) and `PrivateAccountRoute` (guarding all account pages) both authorize the
current visitor by reading `{token, userId, role}` back out of `localStorage['mirwal-session']`
— exactly the "Never trust localStorage.role" failure the Mirwal directive names explicitly, and
the audit's own §6 already flagged this pattern once, in Header's now-fixed fake-name bug.

Confirmed live and exploitable: nothing in the app ever writes that key — `AuthPage`'s login
form is honestly disconnected pending real backend wiring (`submit()` shows "Authentication is
not connected yet" and does nothing else) — so in normal use `getAuthSession()` always returned
null and every guard always redirected to `/login`. But localStorage is writable from same-origin
JavaScript regardless of what the UI does. From the browser console:

```js
localStorage.setItem('mirwal-session', JSON.stringify({ token: 'x', userId: 1, role: 'admin' }))
```

...and `/admin`, previously blocked, rendered — no server round-trip, no verification, just a
client-side object matching the shape `RequireRole` expected. Same for `/seller-center` and
every account page with any `role` value.

The real, server-verified session already exists — `services/apiClient.js`'s in-memory access
token plus `restoreSession()`, which calls `/auth/refresh` and relies on the httpOnly refresh
cookie the page cannot read or forge — but nothing calls `restoreSession()` on app boot, no
component keeps its result in React state, and no route guard reads it. That's real, currently
missing functionality (a session context, wiring login/register submission to `api.auth.*`, a
real logout, and pointing `RequireRole`/`PrivateAccountRoute` at it instead of `auth.js`) — not
a one-line fix, and building it is Phase 2-scale work affecting the header, every protected
route, and checkout.

**Immediate fix applied** (`src/auth.js`): `getAuthSession()` now always returns `null` and
`hasRole()` always returns `false`, with the reasoning recorded in a comment. This closes the
forged-localStorage bypass completely — verified in the browser: the exact forged-admin payload
above no longer grants `/admin` or `/seller-center`, both correctly bounce to `/login` — and is a
no-op for real users, since nothing could produce a real logged-in state through this mechanism
anyway. It does **not** restore login — that still needs the real session wiring described
above, which is a separate decision about scope and sequencing, not a bug fix.

### ShoppingIntentPage / GuidesPage — converted

Both had genuinely editorial content (the curated problem/solution copy, the guide articles),
which stays local rather than becoming a fabricated "editorial API" — the only mock dependency
in either was the product matching. `ShoppingIntentPage` used to filter the mock array with
`product.type.includes(term)`; the real catalog's full-text `q` filter requires every word in a
multi-word query to match the same product (`+laptop* +mouse*` in boolean mode), so
`home-office-setup`'s two terms ("laptop", "mouse") are queried separately and merged — a naive
single `q: "laptop mouse"` would have wrongly returned zero results. `GuidesPage`'s
`RelatedProducts` now pulls real recommended products instead of `products.slice(0, 4)`.

### Critical-path account pages — converted, mostly to honest "not connected yet" states

`AccountUtilityPage`, `ProfileOrdersPage` and `AssistantRelatedPage` back everything under
`/profile`, `/orders`, `/wishlist`, `/track-orders`, `/compare` (an account-area duplicate of
`/compare`), `/addresses`, `/payment-methods`, `/notifications`, `/security`, `/my-chats`,
`/saved-searches`, `/settings` and `/logout` — composed together by `AccountShell.jsx`. This
was the most fabricated cluster found in the whole pass:

- **`ProfilePage`** showed one specific invented identity — name "Muhammad Umar", email, phone
  number, a stock-photo avatar, a Lahore address, "12 Total Orders" — to *any* visitor who
  reached `/profile`, with no session check of any kind deciding whose data it was. There is no
  real session wired to this page yet (see the security finding above), so there is no real
  identity available to show it instead; replaced with an honest not-connected state rather than
  keep displaying someone else's invented life as the viewer's own.
- **`Addresses`/`Payments`** showed the same fabricated address plus fake card numbers ("Visa
  ending in 4242", "EasyPaisa 0333 1234567") as though they were the signed-in user's saved
  payment methods. There is no addresses or payments API. Replaced with honest not-connected
  states — this is the fabricated-PII case the Mirwal directive calls out by name.
- **`TrackOrders`/`ProfileOrdersPage`** simulated an entire order-tracking flow client-side:
  typing an order ID containing the substring "10482" or "10461" produced a fabricated shipment
  timeline with a real-looking courier name and delivery address; any other input was
  "not found." `ProfileOrdersPage` separately showed a fixed 5-order history with fake sellers
  ("MegaMart", "Home Essentials", "Fashion Hub") that don't exist in the real seller data, and a
  fake "12 orders" count. There is no orders API yet. Both replaced with the same honest
  not-connected treatment.
- **`Notifications`** showed a fixed fake activity feed. Replaced likewise.
- **The account area's own `Compare`** was a second, entirely separate implementation from
  `/compare` (`ComparePage.jsx` + `useComparison()`): it always showed the same 3 hard-coded
  products regardless of what was actually selected, next to a spec-comparison table
  (display/processor/RAM/battery/camera) for fields that don't exist anywhere in the product
  schema. It now reads the real shared comparison context, so it agrees with `/compare` instead
  of contradicting it, and dropped the invented spec rows.
- **`WishlistPage`** pre-seeded a *new* visitor's wishlist with 8 arbitrary products they never
  added, fabricated each item's discount percentage from its array position, and hard-coded
  "Only 4 left" on whichever product happened to land at index 6. There is also no real wishlist
  anywhere in the app to fall back to — every "heart" button on every converted page is local
  component state that resets on navigation and was never persisted; building a real, working,
  cross-page wishlist (a Context alongside the existing comparison one, updating every heart
  button sitewide) is a real feature addition, not a data-source swap, so it's out of scope for
  this pass. Given the same honest not-connected treatment as Track Orders/Addresses/Payments.
- **`/recently-viewed`** is the one page in this cluster with something genuinely real to show:
  `mirwal-recent-products` (already written by `ProductPage`'s and `HomePage`'s product cards,
  from earlier in this pass) tracks real per-visitor viewing history. This now hydrates that via
  the API instead of showing a fixed `products.slice(5, 8)`.
- **`Security`**'s action buttons (Change Password, 2FA, Login Activity, Manage Devices, Delete
  Account) previously showed "Your security preference was updated" on click regardless of what
  was clicked — a fake success message for actions that never happened. Now disabled with a
  plain "Not available yet," which is what was actually true.
- **`Logout`** only ever called `navigate('/login')` — it never invalidated any session, real or
  otherwise. Now calls the real `api.auth.logout()` first.

**Also fixed, a real composition bug independent of the fabricated data:** `AccountShell.jsx`
already wraps whatever it renders with its own `<Header>` and `<AccountSidebar>`, but was
rendering the *full standalone page* exports of `AccountUtilityPage`, `ProfileOrdersPage` and
`AssistantRelatedPage` as `content` — each of which renders its own `<Header>` (a no-op; see the
chrome-duplication correction above) **and, for `/profile` and `/wishlist`, its own separate
sidebar** with a different link set and different fabricated badge counts, which is not guarded
against duplication the way `<Header>`/`<Footer>` are. That combination was a real, visible
double-sidebar on `/profile` and `/wishlist`. Fixed by giving each of the three files a
content-only named export (`AccountUtilityContent`, `OrdersContent`, `AssistantRelatedContent`)
for `AccountShell` to compose, matching the pattern `RelatedProducts`-style sub-components
already use elsewhere; each file's default export keeps the full standalone layout, unused by
anything today but consistent with how every other page in this project is structured.

Not verified in the browser: this whole cluster sits behind `PrivateAccountRoute`, which (per
the security finding above) now correctly denies access to everyone, since there is no real
login yet — there is currently no way to reach these pages through the UI at all. Verified by
code review, lint and a full build instead.

### ExploreDiscoverySections — removed (dead code)

Not converted — deleted. `grep -rn "ExploreDiscoverySections" src` found no import of it anywhere
outside its own file; nothing in `App.jsx` or any other component ever rendered it. Converting
its fabricated data (`products[index + 4]?.image` as decoration, a static "Popular searches"
strip) would have been effort spent on a component nobody sees.

### Phase 1 mockData conversion — complete

Verified: `grep -rl "from './data/mockData'" src` (excluding `seller/` and `admin/`) now returns
nothing. Every public-facing page that imported `src/data/mockData.js` directly across this
multi-session pass has been converted to the live API or removed as dead code. What's left
importing it is intentionally mock-only: `server/src/db/seed.js` (development seed data,
explicitly gated against `NODE_ENV=production`) and the seller/admin panel pages not yet in
scope (`seller/pages/Customers.jsx`, `Orders.jsx`, `Products.jsx`, `Reviews.jsx`,
`SellerDashboard.jsx`, and the various `admin/*` pages) — those back a different, later phase
(seller/admin panel completion) and use a separate mock module (`sellerMockData.js`) rather than
the public-storefront `mockData.js` this pass targeted.

---

## Section 22 — Phase 2: real session wiring

The S21 security finding left a real gap: route guards no longer trusted localStorage, but
nothing could produce a real logged-in session either, since `AuthPage`'s login form was
honestly disconnected. This closes that gap — the actual fix the earlier patch was standing in
for, not an alternative to it.

### What was built

- **`components/SessionContext.jsx` + `components/useSession.js`** (split the way
  `ComparisonContext.jsx`/`useComparison.js` already are, to satisfy the fast-refresh
  export-shape lint rule) — a `SessionProvider` wrapping the whole app (alongside
  `ComparisonProvider` in `App.jsx`) that calls `restoreSession()` once on boot (asks the server
  who the visitor is via the httpOnly refresh cookie), exposes `{ user, isLoading, login,
  register, logout, hasRole }`, and listens for `onAuthChange` so a token cleared elsewhere
  (an expired refresh during background API activity, not just an explicit logout) also clears
  `user`.
- **`RequireRole`/`PrivateAccountRoute`** (`App.jsx`) now read `useSession()` instead of the
  deleted `src/auth.js`, and show `<LoadingState/>` during the initial `restoreSession()` call
  instead of assuming signed-out and redirecting before the real answer comes back.
  `PrivateAccountRoute` also now sends a signed-in-but-wrong-role visitor to `/404` instead of
  `/login` (matching `RequireRole`'s existing behaviour) — previously any non-`customer` role,
  including a legitimately signed-in seller or admin, was bounced to the login page.
- **`Header.jsx`** shows the real `user.fullName`/initial from `useSession()` instead of the
  deleted `getAuthSession()`.
- **`AuthPage.jsx`** — was entirely disconnected (`submit()` just showed "Authentication is not
  connected yet" and returned). Now has real controlled form state and calls
  `useSession().login()`/`.register()` against the actual endpoints, shows the server's own
  safe error messages (`"Email or password is incorrect."`, `"An account with that email
  already exists."`) via `describeApiError()`, and redirects to `location.state?.from` (where a
  route guard sent the visitor from) on success. The login field was relabelled from "Email or
  Phone Number" to "Email address" — `loginSchema` only ever accepted email; the old label
  implied phone sign-in that was never supported. Social sign-in and "Forgot Password?" have no
  backend behind them (no OAuth provider, no reset endpoint) — clicking them now says so instead
  of doing nothing silently.
- **`AccountUtilityPage.jsx`'s `Logout`** now calls `useSession().logout()` (which itself calls
  `api.auth.logout()`) instead of the raw API function directly, so the header's signed-in state
  updates immediately rather than only after a reload.
- **`services/api.js`** — `login`/`register` now call `setAccessToken(data.accessToken)` on
  success. They didn't before: the token in the response was discarded, so the very next
  authenticated request would have had none, failed with 401, and only succeeded via
  `apiClient.js`'s retry-on-expiry path — a guaranteed wasted round trip after every login.
- **`src/auth.js`** deleted — nothing references it any more.

### Bug found and fixed: `/auth/refresh` crashed for anyone with no session

`restoreSession()` calls `/auth/refresh` unconditionally on every app boot, cookie or not — that
was already true before this pass, it just had never actually been called from anywhere until
now. `rotateRefreshToken()` hashed the incoming token before checking whether one existed:
`hashRefreshToken` is `createHash('sha256').update(token)`, which throws on `undefined`. A
first-time visitor with no cookie at all — the common case — crashed the endpoint into a generic
500 rather than the plain "not signed in" 401 it should have been. Reproduced directly against
the API: `curl -i -X POST /auth/refresh` with no cookie returned 500 before the fix, 401 after.
Fixed by checking `if (!rawToken) throw invalid` before hashing. Re-verified the two paths this
touches don't regress: normal rotation (200) and reuse-detection on an already-rotated token
(401) both still behave correctly.

### Bug found and fixed: logging back in after Logout landed on the Logout screen

`PrivateAccountRoute` reactively redirects to `/login` with `state.from` set to whichever
protected path just lost its session — which fires for `/logout` itself, since clicking
"Logout" clears the session while still mounted on that route. `AuthPage`'s post-login redirect
followed `state.from` unconditionally, so signing back in landed back on "Are you sure you want
to logout?" instead of home. Reproduced and fixed by excluding `/logout` as a valid redirect
target in `AuthPage`'s `destination()`.

### Verified end-to-end in the browser

Registered a real account (`/register`) → redirected home with the real name in the header →
full page reload on `/profile` correctly stayed signed in (session persisted via the httpOnly
cookie, not anything client-readable) and showed the honest "Profile isn't connected yet" state
from S21, not a fabricated identity → `/admin` correctly 404s for this customer account (a real
role check now, not just "no session at all") → `/track-orders` and `/orders` show their honest
not-connected states with exactly one sidebar → Logout correctly ends the session (subsequent
`/profile` visit bounces to `/login`) → wrong password shows the real, safe "Email or password
is incorrect." message → signing back in works and lands home. Re-ran the S21 forged-localStorage
attack (`localStorage.setItem('mirwal-session', JSON.stringify({role:'admin'}))`) against this
now-real-session state: still correctly denied, `/admin` 404s regardless of what's forged into
localStorage, because nothing reads it any more.

---

## Section 23 — Seller panel: first real-data pass (Dashboard, Products, layout)

With real login working, the seller panel became reachable for the first time — nobody could
actually sign in as a seller before this. The panel is ~75 routes across dashboard, products,
orders, finance, marketing, reviews, customers, support and store settings; converting all of it
is its own phase, not one pass. This pass covers the three highest-traffic pieces: the layout
every seller page shares, the dashboard, and the product list — the same page-by-page approach
used for the public storefront in S21/S22, now applied to the seller side.

### `SellerLayout.jsx` — real store name

`storeName` defaulted to the literal string `'Awais Store'` and nothing ever overrode it, so
**every seller, regardless of which store they actually ran, saw someone else's store name in
their own panel header.** `GET /seller/me/store` already existed, ownership-scoped server-side,
and was unused. This is the first thing in the seller panel to call it — fixed once, at the
layout level, so all ~75 routes it wraps get the real name for free.

### `SellerDashboard.jsx` — real catalogue metrics, honest analytics

Previously: "Total Sales +18.6%", "324 Orders +12.4%", "12,540 Visitors +9.8%", a 2.58%
conversion rate, a hand-drawn SVG line chart with hard-coded points, and a date range
("May 18 - May 24, 2025") that never matched the actual date. There is no orders, payments, or
analytics system to source any of that from — not reshaped onto a smaller real number, the
sales/traffic panel is an honest not-connected state instead. What's real: product counts by
status and stock level, and actual average rating, computed from `GET /seller/me/products`
(already ownership-scoped, already existed, was unused).

### `Products.jsx` — the seller's real product list

Previously: "128 Total, 98 Published, 12 Drafts, 5 Out of Stock, 13 Low Stock" next to a table
of ~8 fake products with fake SKUs, a fake "Added on May 10, 2025" computed from array index,
and fake view/order counts. All of that is a real aggregate of the actual fetched list now. Two
columns are gone rather than faked: **SKU** (products don't have one — only variants do, and
this is one row per product) and **Views/Orders** (no page-view tracking or order aggregation
exists yet). Category filtering is real too — added `category_slug`/`category_name` to
`GET /seller/me/products`'s query (a cheap JOIN addition; the endpoint returned no category at
all before), since a seller product table with no category information at all would have been
a real regression versus even the mock version.

### Verified in the browser: seller isolation holds through the real panel

Logged in as `seller.a@mirwal.test` (Dev Store Alpha): dashboard reads 18 total products, 4 out
of stock, 3 low stock, 4.6/5 average — matching the real seeded data exactly. Products page's
stock filter narrows to exactly the same 4 out-of-stock items. Header reads "Dev Store Alpha".
Logged out, logged in as `seller.b@mirwal.test` (Dev Store Beta): dashboard reads 17 products
(not 18), header reads "Dev Store Beta" — the seller-ownership isolation verified at the API
layer back in Phase 0.5 now holds through the actual UI a seller would use, for the first time.

### Not yet converted

Orders, Finance, Marketing, Reviews, Customers, Support, Store Settings/Profile/Shipping, and
Add/Edit Product — all still read `sellerMockData.js`. Orders/Finance/Marketing/Customers need
backend systems that don't exist yet (orders, payments, coupons, customer accounts linking to
sellers) and should get the same honest not-connected treatment as the equivalent customer-side
pages in S21 rather than fabricated data. Reviews could be partially real today (products already
carry real `rating_average`/`rating_count`) but there's no reviews table to list individual
reviews from yet. Add/Edit Product needs write endpoints (`POST/PUT /seller/me/products`) that
don't exist yet — the backend so far is read-only for sellers.

---

## Section 24 — Seller panel: second pass (Orders, Finance, Marketing, Reviews, Customers, returns, notifications, catalog reference, Add Product)

Continuing S23's page-by-page pass. This batch is almost entirely "no backend exists for this,"
so most of it is conversion to an honest not-connected state rather than a data-source swap —
but three findings are worth calling out specifically:

- **`Orders.jsx`, `Customers.jsx`, `ReturnsRefunds.jsx`, `RequestDetails.jsx`,
  `SellerNotifications.jsx`** — all fabricated the same handful of customer identities
  ("Ali Raza", "Sana Khan", ...) reused across orders, returns, cancellations and reviews as
  if they were different real people, plus fake order IDs, payment methods and a shared phone
  number appearing on every row regardless of "customer." All replaced with an honest
  not-connected state: there is no orders table and no checkout that would create one, so
  there is nothing real any of these pages could show. `RequestDetails.jsx` additionally
  ignored its own `:id` URL param and showed the same fixed fake request regardless of which
  id was requested — moot now that the list it's linked from no longer links anywhere.
- **`FinancePage.jsx`** was in a mixed state — its Settings view had already been converted in
  an earlier pass (disabled actions, "Not provided yet" placeholders) while Overview and
  Withdrawals still showed a fabricated Rs. 52,430 balance, a hand-drawn earnings chart, and a
  withdrawal form that accepted any amount and showed a fake success message. Brought the other
  two views to the same standard.
- **`Marketing.jsx`** was the largest single block of fabrication found in this session — ten
  views (promotions, discounts, coupons, ad campaigns, an AI campaign-creation wizard ending in
  a fake "Campaign Launched! ID: CAM-2048" screen, AI recommendations, performance analytics)
  with zero real data anywhere in any of them. Collapsed to one honest not-connected page for
  every view rather than converting ten pages of invented content individually.
- **`Reviews.jsx`** — the one page in this batch with something real to show. Products already
  carry a real `rating_average`/`rating_count`; the average rating and rated-product count
  shown are a real weighted aggregate of the seller's own products, computed the same way the
  storefront's ratings are trusted elsewhere. Individual review text, replies, and the
  fabricated AI sentiment breakdown ("82% Positive") have no backing table and get the
  not-connected treatment.
- **`CatalogPage.jsx`** (Categories/Brands) — not just "no backend," a genuine ownership-model
  problem: categories and brands are sitewide taxonomy shared by every seller's products, but
  the mock version let a seller freely rename, disable and delete rows here. Wired to the same
  real `GET /categories`/`GET /brands` the public storefront already uses (real names, real
  per-category product counts, matching the storefront exactly), with Add/Edit/Delete disabled
  and explained as "managed by Mirwal, not per seller" rather than left as an authorization gap
  waiting for a backend to make it real.
- **`AddProduct.jsx`** — not converted to real submission (there is no
  `POST /seller/me/products` yet; building one is real backend work, not a data-source swap,
  and was flagged rather than built silently mid-sweep). Fixed a real bug in passing instead:
  several fields in the "Product Details" and "Variants" steps used `defaultValue` with
  realistic-looking example data (fake driver size, SKU, price, stock) — meaning if a seller
  left them untouched, submission would have silently sent that fake data as their real
  product's specs, once a write endpoint existed to receive it. Changed to `placeholder` (never
  submitted). Also replaced a fabricated "AI Readiness Tip" percentage with the real
  steps-completed fraction, and disabled Save Draft/Publish with a visible banner explaining
  nothing on this page is saved yet, rather than letting the flow silently no-op past a
  "Publish Product" button that looked like it worked.

Verified in the browser (`seller.a@mirwal.test`): Orders/Finance/Marketing all show their
not-connected states; Reviews shows a real 4.7 average across 6,347 real reviews on 18 of 18
rated products; Categories shows the real 7 categories with the same product counts as the
public `/categories` page (Electronics 19, Home & Living 5, ... Automotive 0); Add Product shows
the "not wired up to publish" banner. No console errors from any of these pages' own API calls.

---

## Section 25 — Seller panel: third pass (Help Center, Support, Shipping Settings, Store Profile/Settings)

Closes out the seller panel's remaining pages from S23/S24's "not yet converted" list.

- **`SellerHelpCenter.jsx`** — this is genuinely editorial help content (categories, guides,
  FAQs), the same category as `GuidesPage.jsx` on the customer side, so it stays local rather
  than needing a CMS. But its metadata was fabricated: category cards claimed "12 articles,"
  "24 articles" etc. when only one category ("Orders & Shipments") actually has any articles
  behind it — the rest link back to the same category list with nothing category-specific.
  Counts now read 0 (shown as "Coming soon") except the one category with real content (7).
  Video tutorials claimed specific durations ("04:35") for videos that don't exist and don't
  play anything when clicked; now plain "Coming soon" cards. Guide rows claimed "Updated 5 days
  ago • 6 min read" identically on every guide regardless of whether it had ever been touched;
  removed. Separately, **every guide and article link opened the exact same "How to add a new
  product" content regardless of which one was clicked** — "How to set up shipping methods"
  showed instructions for adding a product. Fixed by reading the actual slug from the URL and
  only showing the real content for `add-product`; everything else now honestly says "not
  written yet" instead of showing the wrong article.
- **`SellerSupport.jsx`** (ticketing) — fake ticket IDs/subjects/statuses, fake per-category
  ticket counts, and a "Request Details" page that showed the same one hard-coded ticket
  regardless of which id was in the URL. Its "Create Support Request" form used
  `defaultValue="Payment rejected"` with a matching fake description — left untouched, a real
  submission (if this were ever wired up) would have silently filed a ticket about a payment
  problem the seller never had. There is no ticketing system at all; collapsed to one honest
  not-connected page, the same treatment as Marketing/ShippingSettings.
- **`ShippingSettings.jsx`** (641 lines, 8 tabs: zones, methods, rates, delivery, package,
  pickup, providers, tracking) — fabricated shipping zones, fake pickup addresses and phone
  numbers, and fake "Connected"/"Needs Attention" courier statuses for TCS/Leopards/M&P
  implying real courier integrations that don't exist. Confirmed via `const [zones] =
  useState(defaultZones)` (destructuring away the setter) that nothing on this page was ever
  actually interactive despite looking like a settings UI — there was no real functionality to
  preserve. Collapsed to one honest not-connected page per tab.
- **`StoreSettings.jsx`** — showed a fixed "Mirwal Store" profile (name, "★4.8", "120
  products," "2,456 orders," "24,800 followers") regardless of which seller was signed in.
  "Followers" isn't a real feature anywhere in the schema. Now shows the real store name,
  status and product count from `GET /seller/me/store` / `GET /seller/me/products`, and a real
  weighted-average rating (the same computation `Reviews.jsx` uses); orders and followers get
  an honest not-connected state instead of invented numbers.
- **`StoreProfile.jsx`** (585 lines, 8 tabs) — the one page in this pass with real,
  functioning local form state worth preserving (a genuine dirty-flag with a `beforeunload`
  warning, and a completion percentage honestly computed from the current draft's own filled
  fields) — it was seeded with fake defaults and had nowhere to save to, not fully fabricated
  like the others. Seeded the draft from the real store name/slug/status instead of hard-coded
  "Mirwal Store"/"mirwal-store" (falls back to the fetched value until the seller edits a
  field, avoiding a setState-in-effect anti-pattern). Its "Save" buttons showed "saved
  successfully" regardless of the fact that no write endpoint exists — changed to an honest
  "nothing was actually saved" message. The Store Preview tab (meant to show what the public
  storefront looks like) was the last file in the seller panel still importing the public
  `mockData.js`, showing `products.slice(0, 3)` in the legacy mock shape alongside a fake
  "★ 4.8 · Verified" badge and a "Follow Store" button — a feature that doesn't exist even on
  the real storefront (`SellerPages.jsx`, converted in S22). Now shows the seller's real top 3
  products, real name, and the real weighted rating; dropped the fabricated verification badge
  and follow button. Left as known remaining gaps (lower severity — draft-only UI with no
  persistence either way, not live business data): the brand-color swatches and logo/banner
  previews still show fixed placeholder values and stock photos rather than a real upload flow,
  and the SEO tab's "✓ Title is under 60 characters" checklist is unconditional rather than
  computed from the actual title length.

This closes out every file in S23/S24's "not yet converted" seller-panel list. Verified in the
browser (`seller.a@mirwal.test`): Shipping Settings and Seller Support both show their
not-connected states across all tabs/views tested; Help Center shows real article counts ("7
articles" for Orders & Shipments, "Coming soon" elsewhere) and the `add-product` guide's real
content, while an unrelated guide slug (`shipping-methods`) correctly shows "Not written yet"
instead of the wrong article; Store Profile's Information tab shows the real store name
("Dev Store Alpha") and slug ("dev-store-alpha") in editable fields, and its Preview tab shows
the real top 3 products with real prices and a real 4.7 rating. No console errors from any of
these pages' own API calls.

### Seller panel: remaining work

The seller panel's read side is now real wherever real data exists, and everything else is
honestly marked not-connected rather than fabricated. What's still outstanding is backend, not
frontend: there is still no `POST/PUT /seller/me/products` (so Add/Edit Product can't actually
publish), no orders/payments/shipping/support/marketing systems for the several pages that
depend on them, and no reviews table for individual review text. The admin panel (~91 routes)
has not been touched at all and is a separate, later piece of work.

## Section 26 — Admin panel: starting point and first real-data pass (Dashboard, Header)

The admin panel is a materially harder starting position than the seller panel: confirmed via
`server/src/modules` containing only `auth`, `catalog` and `sellers` — **no admin backend
module exists at all.** Every admin write endpoint (approve a seller, moderate a listing,
manage orders, configure commission, etc.) is entirely absent, not just unwired. The seller
panel could lean on two real, ownership-scoped endpoints (`/seller/me/store`,
`/seller/me/products`); the admin panel has no seller-scoped analogue and can only draw on the
same *public* catalog endpoints anyone can call (`/products`, `/sellers`), which give sitewide
counts but nothing about orders, revenue, or customers. `src/admin/` has 31 files; this section
covers the first two.

- **`AdminHeader.jsx`** — hard-coded "Super Admin" / "Super Administrator" identity for every
  visitor regardless of who was actually signed in, plus a fake unread-notifications badge
  showing "12" and an inert "Messages" button that did nothing. Now uses `useSession()` for the
  real signed-in admin's name and initials, and derives the subtitle ("Super Administrator" vs
  "Administrator") from their real `roles` array. The notification bell keeps its icon but
  drops the fake count and gets `title="Not connected yet"`; the dead Messages button was
  removed outright rather than left disabled, since it had no destination and no page behind it
  even in the fabricated version.
- **`AdminDashboard.jsx`** — the single most fabricated page found in the codebase: a fake GMV
  figure, fake total-orders/total-customers/platform-revenue KPIs, a hand-drawn SVG revenue
  chart, an activity feed of invented events ("Seller \"TechZone\" approved," "12 minutes ago"),
  fake AI-shopping-query stats, a "Top Performing Categories" table with invented per-category
  revenue, a "Latest Orders" table of entirely made-up orders and customer names, a "Top
  Sellers" leaderboard, a "Pending Approvals" queue, and a "Platform Summary" panel of invented
  commission/payout/refund totals. (Its one already-honest section, "System Status," already
  said "Not monitored" for every item and was left untouched.) Of the six original KPIs, only
  two have any real, sitewide backing without an admin backend: total sellers and total
  products, both derivable from the public catalog endpoints (`GET /sellers`'s array length,
  `GET /products`'s `pagination.total`). Rewrote the page around those two real KPIs
  (`api.sellers.list()`, `api.products.list({ pageSize: 1 })`) and replaced every other panel —
  Sales & Orders, Customers, Recent Activity, Pending Approvals, Top Categories, Top Sellers, AI
  Shopping Insights, Platform Summary, Latest Orders — with the admin module's own `EmptyState`
  (`src/admin/AdminStates.jsx`, which takes a `description` prop, not the seller module's
  `text`), each naming the specific missing system (orders, payments, analytics, activity/audit
  log, AI query tracking, approval workflow) rather than a generic "coming soon."

Verified in the browser as `admin@mirwal.test`: header shows the real name "Dev Admin" and
"Super Administrator" (matching the seed account's `super_admin` role); dashboard shows "Total
Sellers: 2" and "Total Products: 35" — matching the exact totals already verified independently
during the seller-panel work (Dev Store Alpha's 18 products + Dev Store Beta's 17). Every other
panel renders its honest not-connected message with no crash. `npx eslint src server` and
`npx vite build` both clean.

- **`AdminCategories.jsx`** — 10 hard-coded rows with invented product counts, fake
  "Active"/"Inactive" statuses, a fake sort order, a fake "May 24, 2025" created date on every
  row, five KPI cards with invented totals ("128 categories," "18 inactive," "245 uncategorized
  products"), and an "Add New Category" form whose Save button just flipped local state to
  "saved" with nothing behind it. Admin genuinely is the right owner for this data (unlike the
  seller panel's version of this same page), but `GET /categories` is still the only real
  endpoint — there is no `POST/PUT/DELETE /admin/categories`, and the public endpoint itself
  only returns active categories with a name, description, image and real active-product count
  (no id, no status, no sort order, no created date). Rewrote the list around what that endpoint
  actually provides — real names, descriptions, and per-category product counts, plus two real
  KPIs (total categories, total categorized products) and one derived one (busiest category) —
  and dropped status/sort-order/created-date columns and the inactive/uncategorized KPIs
  entirely rather than inventing them. Add/Edit/Delete and the "Add New Category" form are
  disabled with `title="There is no admin backend yet"`, the same treatment as the seller
  panel's `CatalogPage.jsx`.

  Note for later: `api.categories.list()` returns a parent/child tree (`children: []` per
  category), but both this page and the seller panel's `CatalogPage.jsx` only render the root
  level — currently harmless since no category in the seeded data has any children, but worth
  flattening properly if a subcategory is ever added.

Verified in the browser as `admin@mirwal.test`: Categories page shows the real 7 categories with
real product counts (Electronics 19, Home & Living 5, Fashion 4, Beauty & Health 3, Sports &
Outdoors 3, Baby & Toys 1, Automotive 0), a real "Categorized Products: 35" total that matches
the dashboard's independently-computed "Total Products: 35," and "Most Products In: Electronics
(19 products)" — all cross-checked against a direct `curl` of `GET /api/v1/categories`.
`npx eslint` and `npx vite build` both clean.

- **`AdminSellerPages.jsx`** (5 views: Sellers, Applications, Verification, Performance, Payouts,
  plus a Seller Detail page) — every view was a hard-coded table of invented stores, owners,
  sales figures, ratings, dates, tax IDs and payout amounts. Worse than fabricated data: "Invite
  Seller"/"Create Payout" showed a "saved locally" success toast for an action that touched
  nothing, "Bulk Actions" claimed to apply to selected rows and did nothing, and Seller Detail's
  "Approve"/"Suspend" buttons set a local success message implying a real moderation decision
  had been recorded when nothing had — the same fake-action bug pattern flagged earlier in
  `AddProduct.jsx`/`SellerSupport.jsx`, but here on a moderation action rather than a form
  field. **Also found a real, latent routing bug**: Seller Detail read `useParams().sellerId`,
  but its route (`/admin/sellers/*` in `App.jsx`) is an unnamed wildcard with no `:sellerId`
  param — so `sellerId` was always `undefined`, and the fabricated version silently fell back to
  always showing the same hard-coded seller (TechZone Store) no matter which row was clicked.
  Fixed by reading the slug from `useLocation().pathname` instead.

  There is no admin backend at all, so applications/verification/performance/payouts have
  nothing real to source from and each collapses to one honest not-connected page explaining the
  specific missing system. The Sellers list and Seller Detail views are real: `GET /sellers`
  (approved sellers only, sitewide) gives name, city, rating and a real active-product count;
  `GET /sellers/:slug` adds description, logo/banner and a real join date; a seller's real
  products come from the same `GET /products?seller=<slug>` filter the public storefront uses.
  Dropped every field the real endpoints can't answer (owner name, email, phone, category, sales
  figures, status besides "approved," documents) rather than inventing them. Approve/Suspend are
  disabled with `title="There is no admin backend yet — nowhere to record this"` instead of
  faking success.

Verified in the browser as `admin@mirwal.test`: Sellers list shows the real 2 sellers (Dev Store
Alpha, Lahore, 18 products; Dev Store Beta, Karachi, 17 products); Seller Detail for
`dev-store-alpha` shows the real name, city, a real "Member since" date, the real seed
description ("Development seed store. Not a real business."), and its 5 real products with real
prices; Approve/Suspend confirmed `disabled` via a DOM check. Applications/Verification/
Performance/Payouts each show their specific not-connected message. `npx eslint` and
`npx vite build` both clean.

- **`AdminProducts.jsx`** — 10 hard-coded rows (borrowing product images from the unrelated
  public `mockData.js`) with invented SKUs, barcodes, sellers, sales counts, ratings and a "May
  24, 2025" created date on every row, six KPI cards claiming "84,291 total products" and "2,340
  pending approval," and an "Add New Product" form whose Save button just flipped local state to
  "saved" with nothing behind it. `GET /products` (the same endpoint the storefront uses) only
  ever returns `status = 'active'` products and deliberately never exposes an exact stock count
  — only in-stock/low-stock/out-of-stock booleans (a prior Phase 0 finding: the mock UI's "Only
  8 items left!" was flagged as false urgency) — so a pending/rejected moderation queue and exact
  stock figures aren't just unbuilt, they're invisible to any endpoint that exists. Rewrote the
  page around real product name/image/category/seller/price/rating/publish-date, real stock
  badges, and KPIs computed from the full real catalog (capped at the API's own 60-row page-size
  limit — `catalog.schemas.js` caps `pageSize` at 60 specifically so no caller can pull the whole
  catalogue in one request; the KPIs are marked as partial once the real catalog exceeds that,
  rather than silently going wrong). Caught and fixed my own bug before shipping: the first draft
  computed "In Stock" as `total - outOfStock`, which double-counted low-stock items inside both
  the "In Stock" and "Low Stock" cards (28 + 7 + 7 summed to 42, not 35) — fixed by making the
  three buckets mutually exclusive ("Healthy Stock" = total − out-of-stock − low-stock). SKU,
  barcode, sales counts, and Export/Import/Add New Product are dropped or disabled rather than
  invented.

Verified in the browser as `admin@mirwal.test`: Products page shows all 35 real products across
both dev sellers, with real prices, categories and ratings; KPIs read "Total Products 35,
Healthy Stock 21, Low Stock 7, Out of Stock 7" (21+7+7=35, confirmed via a DOM check after the
fix). `npx eslint` and `npx vite build` both clean.

- **`AdminCustomerPages.jsx`** (Customers, Seller Reviews, Seller Complaints, Blocked Accounts,
  plus a Customer Detail page) — invented customer names/emails/phones/spend, fake seller
  reviews and star ratings, fake complaint tickets, a fake "Blocked Accounts" list with invented
  ban reasons, and a "Customer Details" page that always showed the same hard-coded "Ali Hassan"
  profile regardless of which row was clicked — its route, `/admin/customers/*`, is the same kind
  of unnamed wildcard with no id param found in `AdminSellerPages.jsx`, so there was never a real
  id to read in the first place. Unlike sellers/products/categories, there is no public sitewide
  endpoint to fall back on here — a customer's identity and order history are private account
  data, not catalog data admin can browse the same way a shopper does. There is no admin
  customer-management endpoint, no reviews-moderation endpoint, no complaints/ticketing system,
  and no account-blocking system anywhere in the backend. Collapsed all five views to one honest
  not-connected page each, naming the specific missing system.

- **`AdminOrderPages.jsx`** (Orders, Disputes, plus Order/Dispute/Refund/Return detail) —
  invented order IDs, customers, amounts, payment methods and delivery timelines, and a detail
  page that always showed the same hard-coded `#MW-98765` order (down to the same tracking
  number) regardless of which row was clicked — `onFirstClick` for the orders table never read
  the clicked row at all. Mirwal has no checkout and no orders table, so unlike sellers/products
  there is no real data source of any kind. Collapsed every view to one honest not-connected
  page.
- **`AdminFinancePages.jsx`** (Finances, Business, Marketplace, Seller, Customer and AI
  Analytics) — invented revenue/payout/commission/profit figures, a hand-drawn SVG trend line
  that never changed, and a donut chart with a fixed total. No payments, orders or AI-tracking
  system exists to compute any of this from. Collapsed all six views to one honest not-connected
  page each.
- **`AdminMarketingPages.jsx`** (Flash Sales, Banners, Financial Sections, Campaigns, Coupons,
  Promotions, their shared "Create" wizard, and a coupon detail page) — invented sale names,
  banner positions, campaign budgets/ROI, coupon usage counts, and a coupon detail page that
  always showed the same hard-coded "SUMMER20" regardless of which coupon was clicked. No
  marketing system exists anywhere in the schema. Collapsed every view to one honest
  not-connected page, the same treatment as the seller panel's `Marketing.jsx`.
- **`AdminCustomerPages.jsx`** (Customers, Seller Reviews, Seller Complaints, Blocked Accounts,
  plus a Customer Detail page) — invented customer names/emails/phones/spend, fake seller
  reviews and star ratings, fake complaint tickets, a fake "Blocked Accounts" list with invented
  ban reasons, and a "Customer Details" page that always showed the same hard-coded "Ali Hassan"
  profile regardless of which row was clicked — its route, `/admin/customers/*`, is the same kind
  of unnamed wildcard with no id param found in `AdminSellerPages.jsx`, so there was never a real
  id to read in the first place. Unlike sellers/products/categories, there is no public sitewide
  endpoint to fall back on here — a customer's identity and order history are private account
  data, not catalog data admin can browse the same way a shopper does. Collapsed all five views
  to one honest not-connected page each.
- **`AdminMarketplacePages.jsx`** (Brands, Attributes, Inventory, Products Approval, Products
  Reports) — invented brand/attribute counts, exact stock/reserved/available numbers, a
  pending-approval queue of products that (per `AdminProducts.jsx`) can never actually appear
  through any real endpoint, and fake user-submitted product reports. Brands got the same real
  conversion as Categories (`GET /brands`: real name + real active-product count; Add/Edit/Delete
  disabled — no admin backend). Inventory doesn't get its own real page: exact stock figures are
  deliberately never exposed by the catalog API (the Phase 0 audit's "false urgency" finding), so
  the only honest version of it is what `AdminProducts.jsx` already built — this page now points
  there instead of duplicating it. Attributes/Approvals/Reports collapse to a not-connected page
  each, since no attribute system, approval workflow, or reporting system exists.

Verified in the browser as `admin@mirwal.test`: Orders, Finances, Flash Sales, Inventory and
Customers each show their specific not-connected message; Brands shows the real 30 brands
derived from the real 35-product catalog (e.g. "Samsung 3," "Apple 2," "Philips 2," matching
products seen on the Products page). `npx eslint src server` and `npx vite build` both clean.

- **`AdminStorePages.jsx`** — "Stores" and "Sellers" (`AdminSellerPages.jsx`) were built as two
  separate fabricated sections with two separate invented datasets in the original template, but
  Mirwal's schema has exactly one `sellers` table — a seller account and its one storefront are
  the same real entity, not two. So this wasn't a second fabrication to collapse, it was the same
  real `GET /sellers` / `GET /sellers/:slug` / `GET /products?seller=` data as the Sellers
  section, applied a second time under the Stores heading, minus the moderation actions that
  belong on the account view. **Also found a sidebar link with no dedicated route**: "Store
  Applications" (`/admin/store-applications`) had no matching route in `App.jsx`'s specific
  `/admin/*` list, so it fell through to the generic `AdminPage` catch-all and rendered a plain
  "No store applications found" placeholder rather than 404ing (correcting an earlier draft of
  this entry, which wrongly claimed it 404'd — the `/admin/*` catch-all was already there before
  this change). Gave it its own route to the already-built Seller Applications not-connected
  page instead, since "a pending queue of stores to approve" is the same nonexistent concept as
  "a pending queue of sellers to approve" and the specific message is more useful than the
  generic fallback, even though the fallback was not actually broken.

Verified in the browser as `admin@mirwal.test`: Stores list shows the same real 2 stores as the
Sellers list; `/admin/stores/dev-store-beta` resolves to the real Dev Store Beta (Karachi, 17
products, real seed description); `/admin/store-applications` now renders the more specific
Seller Applications message instead of the generic catch-all placeholder. `npx eslint` and
`npx vite build` both clean.

- **`AdminMessagingPages.jsx`** and **`AdminNotificationSettings.jsx`** (Email/SMS config, 8-9
  tabs each) — invented delivery-rate KPIs, a fake activity feed, notification-template rows for
  events that never fire, a fake send log, and SMTP/provider config fields pre-filled with fake
  credentials that saved nowhere. Mirwal sends no email or SMS anywhere in the system — no
  provider is connected, no transactional message has ever gone out — so there's nothing real to
  configure, template or log in either file. Collapsed every tab in both to one honest
  not-connected page each (tab navigation kept, since it's real navigation, not fabricated data).
- **`AdminNotifications.jsx`** — the entire admin notification feed was fabricated: invented
  seller-application/payout/report/review items with fake relative timestamps, a fake unread
  count, and "Mark all as read" toggling notifications that were never real. There is no
  activity/notification system anywhere in the backend. Collapsed to one honest not-connected
  page.
- **`AdminPaymentSettings.jsx`** (9 tabs: Overview, Gateways, Currency, Tax, Invoice, Refund,
  Payout, Security, Webhooks) — claimed a fully working payments stack: "8 active gateways,"
  JazzCash/EasyPaisa/Stripe/PayPal all marked "Active" with working-looking toggles, a fake
  recent-transactions feed, and config forms with a "Save Configuration" button that saved
  nowhere. Mirwal has no payment gateway integration at all. Collapsed every tab to one honest
  not-connected page.
- **`AdminPlatformSettings.jsx`** (11 tabs) — a wall of feature-flag toggles (Maintenance Mode,
  Auto Approve Sellers, Multi Vendor, Auction System, PWA, ...) backed only by local `useState`,
  plus a sidebar summary with invented platform-wide totals ("Registered Users 12,456"). There is
  no settings-storage system anywhere — nothing in Mirwal reads a persisted platform
  configuration. Collapsed every tab to one honest not-connected page.

Verified in the browser as `admin@mirwal.test`: Notifications and Payment Settings both show
their honest not-connected messages instead of fabricated data. `npx eslint src server` and
`npx vite build` both clean.

- **`AdminSearchConfiguration.jsx`** (9 tabs) — implied a real search-engine stack: "Laravel
  Scout (Meilisearch), Active, 256,780 indexed items," an Elasticsearch engine, configurable
  facets/synonyms/ranking, and search analytics. Mirwal's real search is a single MySQL
  `MATCH() AGAINST()` FULLTEXT query (`catalog.service.js`) — no separate search engine, index,
  synonym system, or analytics logging exists. Collapsed every tab to one honest not-connected
  page.
- **`AdminSecurityPages.jsx`** (8 tabs) — invented a multi-admin user roster ("Sarah Khan -
  Administrator," "John Doe - Manager"), a fake login-activity log with IP addresses, and
  2FA/rate-limit/IP-whitelist/security-header settings that saved nowhere. There is no admin
  user-management system, no 2FA, no admin-configurable rate limits (the real limit in
  `server/src/config/env.js` is a fixed server value), no IP whitelist, and no security event
  log. Collapsed every tab to one honest not-connected page.
- **`AdminSettingsPages.jsx`** (9 tabs) — the same fabrication as `AdminPlatformSettings.jsx`
  under a different route/sidebar heading: feature toggles and fields backed only by local
  state, plus a fake "Google Analytics ID" and "Custom CSS" field. Same gap: no
  settings-storage system exists. Collapsed every tab to one honest not-connected page.
- **`AdminShippingPages.jsx`** (8 tabs) — the admin-side twin of the seller panel's
  `ShippingSettings.jsx`: invented zones/methods/rates/warehouses and courier partners (TCS,
  Leopards, DHL, FedEx all "Active"), a fake 98.2% on-time delivery ring chart. No real shipping
  system exists anywhere in Mirwal. Collapsed every tab to one honest not-connected page.
- **`AdminSystemLogs.jsx`** (Error Logs + System Logs, plus sub-pages) — invented error counts,
  a hand-drawn SVG trend chart, and a log table of fake entries with fake IP addresses and
  geolocations ("New York, US," "Dubai, UAE") for a single-region Pakistani marketplace with two
  dev accounts. The server does write to a log stream, but nothing exposes it to a queryable
  endpoint. Collapsed to one honest not-connected page.
- **`AdminTaxCommission.jsx`** (9 tabs) — invented tax rules/classes/rates, commission plans, and
  revenue figures. **Its Payout Settings tab pre-filled a fake bank account number and IBAN**
  (`1234567890123456`, `PK36MEZN0000123456789012`) as if Mirwal's real payout bank details were
  on file — exactly the class of fabricated financial information the project's no-fake-data rule
  exists to prevent, even though the fields never saved anywhere. There is no tax, commission or
  payout system — it needs a real orders and payments backend first, and neither exists.
  Collapsed every tab to one honest not-connected page.

Verified in the browser as `admin@mirwal.test`: Tax & Commission and Error Logs both render their
honest not-connected messages with tab navigation intact. `npx eslint src server` and
`npx vite build` both clean.

## Section 27 — Admin panel: closing out the sweep (AI, API/webhooks, administration, integrations, shared components)

- **`AdminAIPages.jsx`** and **`AdminAIConfiguration.jsx`** — invented shopping queries
  attributed to real-looking user names, fake recommendation click-through rates and product
  comparisons, and a fake multi-provider AI stack (OpenAI/Anthropic/Gemini/Llama all "Active"
  with masked fake API keys, specific fake models like "GPT-4o"/"Claude 3.5 Sonnet"). There is no
  AI query-tracking, recommendation, comparison, or provider-integration system anywhere in
  Mirwal. Collapsed every view in both files to one honest not-connected page.
- **`AdminAPIWebhooks.jsx`** (9 tabs) — invented API keys with realistic-looking fake secrets
  (`mk_live_1a2b3c4d5e6f...`, `whsec_••••••••••••`), fake third-party integrations (SendGrid,
  Razorpay, Google Maps, Cloudinary, Sentry, Twilio all "Active/Live"), and webhook endpoints
  pointed at `https://example.com/webhooks/...`. Mirwal has no public API-key system and no
  webhook delivery system. Collapsed every tab to one honest not-connected page.
- **`AdminAdministrationPages.jsx`** (Admin Users, Teams, Login Sessions, Admin Activity, Audit
  Logs, Access Control, Roles & Permissions) — an invented multi-admin roster, fake teams and
  leads, fake login sessions with partially-masked IPs, a fake activity/audit trail, and an
  access-control matrix of checkmarks for roles that don't exist. The same gap
  `AdminSecurityPages.jsx` found for its own "Users & Roles" tab: no admin user-management system
  exists beyond the seeded accounts. Collapsed every view to one honest not-connected page.
- **`AdminIntegrations.jsx`** (9 tabs) — claimed a fully connected integration stack: payment
  gateways and shipping providers all marked "Active," third-party services (Google Analytics,
  AWS S3, Firebase, Twilio, reCAPTCHA) marked as connected, and masked fake API keys. None of
  these integrations exist anywhere in the codebase. Collapsed every tab to one honest
  not-connected page.
- **`AdminPage.jsx`** (the `/admin/*` catch-all) — its two named sub-pages, Backup & Restore and
  Maintenance Mode (plus every sub-page: scheduled backups, destinations, IP allowlist,
  maintenance pages), were fully fabricated: an invented "285.6 GB used storage" breakdown across
  Google Drive/S3/Dropbox, a fake backup history and restore flow, and a fake maintenance-mode IP
  allowlist and visit chart. There is no backup/restore or maintenance-mode system anywhere in
  Mirwal. Collapsed both to one honest not-connected page each. The file's actual catch-all
  behavior — a generic per-segment empty state for any unmatched `/admin/*` path — was already
  honest and is unchanged.
- **`AdminErrorPage.jsx`** — the generic error boundary page had a hard-coded fake timestamp
  ("Time: May 24, 2025 10:30 AM") on every render, implying a specific error had just occurred
  regardless of when the page actually loads. Fixed to show the real current time. Also dropped
  the static "Error Code: 500," since this component isn't wired to any real error status and
  displaying one implied a specific failure that was never actually diagnosed.
- **`AdminSidebar.jsx`** — **found three fabricated notification badges**: "Notifications" showed
  a fixed "12," "Product Approvals" showed a fixed "18," and seller "Applications" showed a fixed
  "42" — implying pending counts for systems that (per this section and S22-S26) don't exist at
  all. Removed all three; nothing else in the file was fabricated (it's pure navigation
  structure).
- **`AdminComponents.jsx`** — reviewed; contains only reusable presentational components
  (`Heading`, `Kpis`, `Filters`, `Table`) that render whatever data a caller passes in. No
  fabricated content of its own; no changes needed.

**Correction to S26**: that section's `AdminStorePages.jsx` entry claimed the sidebar's "Store
Applications" link (`/admin/store-applications`) had no route and "every click 404'd." That was
wrong — `/admin/*` was already a catch-all handled by `AdminPage.jsx` before this change, so the
link fell through to a generic (if oddly worded) "No store applications found" placeholder, not
a 404. The fix (giving it its own route to the Seller Applications page) still stands as an
improvement — a more specific, accurate message — but the "broken link" characterization has
been corrected in place in S26 rather than left standing.

Verified in the browser as `admin@mirwal.test`: AI Overview, Integrations, Admin Users, and
Backup & Restore all show their specific not-connected messages; the sidebar's `<em>` badge
elements are confirmed absent via a DOM query (previously 3); the Error Page shows a real,
current timestamp instead of the fixed "May 24, 2025" one. `npx eslint src server` and
`npx vite build` both clean throughout every file in this section.

## Section 28 — Admin panel: complete

All 31 files in `src/admin/` have now been triaged and converted, closing out the admin-panel
phase of the fabricated-data sweep started in Section 26. Summary of what ended up real vs.
honestly not-connected:

**Converted to real data** (5 files): `AdminHeader.jsx` (real signed-in admin identity),
`AdminDashboard.jsx` (real total sellers/products KPIs), `AdminCategories.jsx` (real categories +
product counts), `AdminSellerPages.jsx` + `AdminStorePages.jsx` (real seller/store list, detail,
and products — the same underlying data shown twice under different sidebar headings, matching
the schema's single `sellers` table), `AdminProducts.jsx` (real sitewide product list, KPIs, and
stock status) and `AdminMarketplacePages.jsx`'s Brands view (real brands + product counts).

**Collapsed to honest not-connected pages** (24 files): everything touching orders, payments,
payouts, commission, shipping, marketing/promotions, messaging/notifications, AI, search-engine
configuration, security/2FA, admin user-management, third-party integrations, API/webhooks,
backups, and maintenance mode — none of which have any backend support anywhere in the codebase.

**Genuine bugs found and fixed along the way** (not data fabrication, but real defects):
1. Seller Detail page (`AdminSellerPages.jsx`) always showed the same hard-coded seller
   regardless of which row was clicked — its route was an unnamed wildcard with no id param to
   read from `useParams()`. Fixed by parsing the slug from `useLocation().pathname` instead.
2. `AdminProducts.jsx`'s first-draft stock KPIs double-counted low-stock items inside the
   "In Stock" bucket (28 + 7 + 7 summed to 42, not 35) — caught and fixed before shipping by
   making the three buckets mutually exclusive.
3. Three fabricated notification badges in `AdminSidebar.jsx` ("12," "18," "42") implying
   pending counts for systems that don't exist — removed.
4. `AdminTaxCommission.jsx`'s Payout Settings pre-filled a fake bank account number and IBAN —
   the kind of fabricated financial data the project's core rule exists to prevent, even though
   it never saved anywhere. Removed along with the rest of the tab's content.
5. `AdminErrorPage.jsx` showed a hard-coded fake timestamp on every render. Fixed to show the
   real current time.

**What's still outstanding is backend, not frontend**: the admin panel's honest-not-connected
pages will stay that way until Mirwal has an orders/payments system, a moderation/approval
workflow, a messaging provider, and an admin-specific API surface — none of which are in scope
for this frontend-data-fabrication sweep. The master directive's broader remaining phases
(building those backend systems, testing, production hardening) remain untouched and out of
scope until reached in sequence.

---

## Section 29 — Real orders/cart/checkout backend

With every panel's fabricated data triaged (Sections 21–28), the single most-cited blocker
across both the seller and admin sweeps was the same: "there is no real orders system." This
section builds one — a real `orders`/`order_items` schema, a checkout endpoint that re-prices
and re-validates stock server-side, and the frontend wiring that replaces `CheckoutPage.jsx`'s
fake `placeOrder` (which only ever showed "Checkout is not connected") with a working purchase
flow.

### Investigation before building

Before designing anything, the existing cart/checkout frontend was audited to avoid inventing a
backend contract that didn't match what the UI already assumed:

- **Cart**: plain `useState` in `App.jsx`, in-memory only, no persistence, no context
  abstraction (unlike `SessionContext`/`ComparisonContext`). `toCartItem`/`lineTotal`/
  `lineSaving` in `src/lib/money.js` already established the item shape and minor-units money
  contract to match.
- **Checkout**: `CheckoutPage.jsx`'s `placeOrder` never called any API — it just set a status
  message. The form offered Express Delivery (Rs. 250), Online Payment and Bank Transfer as if
  real, plus a "Save this address for next time" checkbox with no address book behind it.
- **Confirmation**: `OrderConfirmationPage.jsx` already, correctly, showed an honest
  "unavailable" message rather than fabricating a success screen — kept as the real fallback for
  a stale/invalid order id.
- **Database**: only `auth`/`catalog` migrations existed (users/roles, sellers/products/
  variants/inventory). No orders, cart or payments table anywhere, not even unused.

### What was built

**`server/src/db/migrations/003_orders.sql`** — two new tables, following the exact
conventions of `002_catalog.sql` (BIGINT surrogate keys + `public_id` UUID, `DECIMAL(12,2)`
money, `DATETIME(3)`, explicit `utf8mb4`/collations, `CHECK` constraints):
- `orders` — one row per checkout: buyer, totals, status
  (`pending→confirmed→processing→shipped→delivered`, or `cancelled`), payment method/status,
  and the shipping address **embedded** on the row rather than normalised into an address book
  — there is no saved-addresses feature yet, and an order is a snapshot of where it shipped
  regardless of what the buyer's address book looks like later.
- `order_items` — one row per line, carrying its own `seller_id` (the same ownership column
  role as `products.seller_id`) so a seller's fulfillment queue is exactly
  `WHERE seller_id = ?`, and its own `status`, because a multi-seller order ships per seller,
  not as one unit. Product name/variant/SKU/price are **snapshotted** at purchase time so a
  later rename or reprice by the seller never rewrites what a past order says was bought.
- New `order.read`/`order.write` permissions, granted to `seller`/`admin`/`super_admin` —
  holding `order.write` as a seller means "order items of my store," enforced by `seller_id` in
  the query, the same pattern as `catalog.product.write`.

**Deliberate scope cuts, stated as such rather than silently built as if complete:**
- **No server-side cart table.** The cart stays exactly what it already was — an in-memory
  client-side draft — because there's no guest-cart-merge-on-login problem worth a schema until
  Mirwal needs one. The server's job starts at checkout, where every price and every unit of
  stock is re-validated from scratch regardless of what the client sent.
- **Cash on Delivery only.** `payment_method` is an `ENUM('cod')` with a single value on
  purpose. Mirwal has no payment gateway integration — offering "Online Payment" or "Bank
  Transfer" as choices, as the old UI did, would be exactly the kind of fabricated capability
  this whole sweep exists to remove.
- **Free shipping.** There is no carrier/shipping-cost model, so `shipping_fee` is always 0
  rather than an invented flat rate (the old UI charged a fabricated Rs. 250 for "Express").
- **No buyer address book.** Checkout collects a shipping address per order; there is no
  "saved addresses" management UI. (`AccountUtilityPage.jsx`'s Addresses page already, honestly,
  says this isn't connected.)

**`server/src/modules/orders/`** (schemas/service/controller/routes, mirroring the
`catalog`/`sellers` module structure):
- `POST /orders` — checkout. Runs inside `withTransaction`: every requested
  `{productId, sku?, quantity}` is re-read and **row-locked** (`SELECT ... FOR UPDATE`) against
  `products`/`product_variants`/`inventory`, rejecting anything inactive, deleted, or with
  insufficient sellable stock (`quantity - reserved`). Unit price is read from the variant (or
  product) row, never from the request body — a tampered client-supplied price cannot become a
  real charge. Inventory is decremented in the same transaction, so a failed line rolls back
  everything, not just itself.
- `GET /orders`, `GET /orders/:id` — a buyer's own orders, scoped to `req.user.id`; no route
  accepts a buyer id as a parameter.
- `GET /seller/me/orders`, `PATCH /seller/me/orders/:id/status` — added to the existing
  `seller.routes.js` (seller-scoped concerns stay in the sellers module, matching how
  `/seller/me/products` already works). Ownership is re-checked in the service layer
  (`item.seller_id !== sellerId → forbidden`), and status changes are constrained to a
  forward-only transition table (`pending→confirmed→cancelled`, `confirmed→processing→cancelled`,
  `processing→shipped→cancelled`, `shipped→delivered`) — a seller cannot jump an order straight
  to "delivered," and cannot touch another seller's item at all.
- `server/src/lib/money.js` — the `{amount, currency, display}` formatter was duplicated
  inline in `catalog.service.js`; extracted so `orders.service.js` doesn't reimplement it.

### Frontend: `CheckoutPage.jsx`, `OrderConfirmationPage.jsx`, `ProfileOrdersPage.jsx`, seller `Orders.jsx`

- **`CheckoutPage.jsx`** — rewritten from a fake `placeOrder` to a real controlled form that
  calls `api.orders.create(...)` and navigates to `/order-success/:id` on success. Removed the
  fake Express Delivery / Online Payment / Bank Transfer choices and the no-op "save address"
  checkbox; replaced with the one real option each (free Standard shipping, Cash on Delivery),
  each labelled honestly ("the only payment method Mirwal supports today") rather than just
  disabled.
- **`OrderConfirmationPage.jsx`** — now fetches the real order via `GET /orders/:id` and shows
  what was actually placed (order number, real line items, real totals, real shipping address).
  The pre-existing `.order-confirmed`/`.order-confirmed-summary` CSS in `order-confirmation.css`
  had already been built for this and had nothing to render it for — reused as-is. The
  "unavailable" state is kept as a real fallback for a stale id or another account's order.
- **`ProfileOrdersPage.jsx`** (`/orders`) — replaced the honest-not-connected state with a real
  order list via `GET /orders`, reusing `.order-row`/`.order-id`/`.order-status` CSS in
  `ai-assistant.css` that was, likewise, already built for this. An order's displayed status is
  a rollup of its items (Delivered only once every item is; Shipped if any item has gone out;
  Cancelled only if every item is; otherwise Processing) because a multi-seller order ships per
  seller, not as one unit.
- **Seller `Orders.jsx`** — replaced the honest-not-connected state with real order items via
  `GET /seller/me/orders`, reusing `orders.css`'s `.orders-table`/`.order-status-select`. The
  status dropdown calls the real `PATCH .../status`; only forward transitions are offered as
  options, because the backend would reject the rest anyway.
- **`SellerSidebar.jsx`** — found while wiring the Orders badge: the "Orders" nav item showed a
  hard-coded **24** regardless of the signed-in seller's real order count, "Returns & Refunds"
  showed a fake **2**, and "Ads Campaigns" showed a fake **New** badge (Marketing was already
  collapsed to not-connected in Section 24). The Orders badge is now a real count of the
  seller's own not-yet-delivered/cancelled items (0 → no badge, matching the empty state);
  the other two fake badges were removed outright since neither feature exists.
- **Cart persistence** — found while testing the checkout flow: the cart (`cartItems` in
  `App.jsx`) had never persisted across a page reload, a real UX gap independent of the backend
  work. Added a `localStorage` mirror (`mirwal-cart`) with a lazy `useState` initializer and a
  write-on-change effect; the cart itself is still purely a client-side draft — checkout
  re-validates everything server-side regardless of what's stored.

### Verified in the browser

Logged in as `customer@mirwal.test`: added Bose QuietComfort Headphones to cart from its
product page, confirmed the cart survived a full page navigation (proving the new localStorage
persistence works), completed checkout with a real shipping address, and landed on a real
`Order MW-000002 confirmed` page with the correct item, seller, and total. `/orders` then showed
both this order and an earlier API-level test order (`MW-000001`, a MacBook + 2 Bose
headphones), each with a correct rollup status and correct multi-item summary ("+1 more item").
`localStorage['mirwal-cart']` was confirmed empty after checkout.

Logged in as `seller.a@mirwal.test` (Dev Store Alpha): `/seller-center/orders` showed all three
real order items belonging to that store, each with the real buyer's shipping name/city (needed
to fulfill it, not a privacy leak — the same information a courier waybill would carry), the
real amount, and a live status dropdown. Changed one item's status from Pending to Confirmed
through the actual dropdown (not curl) and confirmed the request hit
`PATCH /seller/me/orders/3/status → 200`, followed by a real refetch. The sidebar's Orders
badge read a real **3**.

Logged in as `seller.b@mirwal.test` (Dev Store Beta, a seller with zero real orders): the same
page correctly showed the honest empty state ("No orders yet") with no badge — confirming
ownership isolation holds through the real UI, not just at the API level (which was also
verified directly: Seller B's token gets `[]` from `GET /seller/me/orders`, and a `PATCH` against
Seller A's order item returns `403 FORBIDDEN — This order item does not belong to your store`).

Also verified directly against the API: the real out-of-stock product (iPhone 15, seeded with
zero inventory) correctly rejects checkout with `409 INSUFFICIENT_STOCK`; a valid two-item,
two-seller cart correctly splits into `order_items` with the right `seller_id` on each; inventory
was confirmed decremented afterward (Bose 45→43, MacBook 3→2); and an invalid forward status
jump (`confirmed → delivered`, skipping `processing`) correctly returns
`409 INVALID_STATUS_TRANSITION`.

`npx eslint src server` and `npx vite build` both clean throughout.

### Not yet built (at the end of this section)

Everything the admin-panel sweep already named as blocked on "no orders system" is now
partially unblocked (real order data exists), but the admin side itself was not wired up in
this section — `AdminOrderPages.jsx`, `AdminFinancePages.jsx` and the rest remained honest
not-connected pages, since this section's scope was the buyer/seller checkout path, not an
admin order-management API. (Picked up in Section 30, immediately after.) Also still missing: a
real payment gateway (COD is the only method), a real shipping/carrier integration (shipping is
always free because there's no cost model to charge from), refunds/returns (there's a
fulfillment state machine but no reversal path), and a buyer address book. These are natural
next slices of the same "orders" phase, not new problems discovered.

---

## Section 30 — Admin order management, now that real order data exists

Section 29 left the admin panel's `AdminOrderPages.jsx` as a not-connected page because, at the
time, there was no orders system to source it from. That's no longer true, so this section
builds the first admin-specific backend endpoints Mirwal has ever had and wires the real
"All Orders" list and order detail view to them. Disputes and the dispute/refund/return detail
modes are untouched — those still have no system behind them at all, which is a materially
different gap than "an orders table exists but nothing reads it as admin."

### Backend: `server/src/modules/admin/`

The first admin backend module. Mirwal's `server/src/modules/` previously had only `auth`,
`catalog`, `sellers` and (as of Section 29) `orders` — no `admin` module existed, which is why
the entire 91-route admin panel was either fabricated or honestly not-connected in Sections
26–28. Rather than build a large admin API surface speculatively, this adds exactly the two
endpoints the real order data unlocks:

- `GET /admin/orders` — every order sitewide (not scoped to any one seller or buyer, since
  admin is the one role that legitimately sees across the whole marketplace), gated by
  `requireRole('admin', 'super_admin')` + `requirePermission('order.read')` (the same
  permission granted to sellers in Section 29's migration, reused here for the admin role it
  was already granted to).
- `GET /admin/orders/:id` — one order's full detail, including the buyer's name/email (an
  admin, unlike a seller, legitimately needs to identify the buyer, not just where to ship).

`listOrdersForAdmin()` in `orders.service.js` computes each order's displayed status as a SQL
rollup over its items (`SUM(oi.status = 'delivered')` etc.) rather than exposing the raw
`orders.status` column, which is never updated after checkout and would read "pending" forever
regardless of what actually happened — the same rollup logic `ProfileOrdersPage.jsx` already
computes client-side for a buyer's own orders, done here in SQL so the admin list doesn't need
a second query per order.

Verified directly: `admin@mirwal.test` gets a real 200 with both seeded test orders;
`customer@mirwal.test`'s token against the same endpoint gets a real
`403 FORBIDDEN` — the RBAC gate is enforced server-side, not just hidden by a frontend route
guard.

### Frontend: `AdminOrderPages.jsx`

- **All Orders** — real list via `GET /admin/orders`, reusing `order-pages.css`'s
  `.order-table`/`.order-kpis`/`.order-status` classes and the shared `Table`/`Heading`/
  `Filters` components from `AdminComponents.jsx` (the same components `AdminMarketplacePages.jsx`'s
  real Brands conversion already used). KPI cards show real Total/Processing/Shipped/Delivered
  counts — no fabricated "vs last 7 days" percentage change, because there's no historical
  snapshot to compute one from; the shared `Kpis` component that renders that arrow was
  deliberately not reused here for the same reason it wasn't in the Brands page.
- **Order Details** — real order via `GET /admin/orders/:id`, with the id read from the URL
  path (the route is an unnamed `/admin/orders/*` wildcard, the same shape that caused
  `AdminSellerPages.jsx`'s "always shows the same seller" bug in Section 26 — fixed here the
  same way, by parsing `location.pathname` instead of assuming a named param). Shows the real
  buyer, shipping address, payment status, and every line item with its own real per-item
  status (`pending`/`confirmed`/`processing`/`shipped`/`delivered`/`cancelled` — the two
  pre-fulfillment states map onto the existing "processing" CSS class rather than falling back
  unstyled, which would have rendered them the same success-green as "delivered").
- **Disputes / dispute / refund / return** — unchanged from Section 29: still honest
  not-connected pages, since none of those systems exist regardless of orders now being real.

### Verified in the browser

Logged in as `admin@mirwal.test`: `/admin/orders` shows both real seeded orders (buyer name,
real item counts, real totals, real rollup status "Processing" for both — correct, since
neither order has a shipped or fully-delivered/cancelled item yet) and real KPI counts.
Clicking a row's order number correctly opens that order's own detail page (verified for
`MW-000001`, showing the real buyer `Dev Customer`/`customer@mirwal.test`, the real shipping
address, and both real order items with their actual current per-item status — one
"Confirmed" from Section 29's live status-change test, one still "Pending"). Manually visiting
`/admin/orders/MW-000001` (the human order number rather than the real internal order id the
row-click resolves to) correctly shows the app's generic error state rather than someone else's
order or fabricated content — confirming the lookup is real, not silently falling back.
`/admin/disputes` still shows its honest not-connected message.

`npx eslint src server` and `npx vite build` both clean.

---

## Section 31 — Buyer address book

`AccountUtilityPage.jsx`'s Addresses page was an honest not-connected state ("Address
management needs a real account and checkout system, which aren't wired up yet"), written
before either existed. Both now do (Sections 22 and 29), so this section builds the address
book itself and wires it into checkout — the actual point of one being to stop retyping the
same address on every order.

### Backend: `server/src/modules/addresses/`

New `addresses` table (migration `004_addresses.sql`), deliberately kept separate from
`orders.shipping_*`: a saved address is a reusable, editable entry in a buyer's own address
book, while an order's shipping address is an immutable snapshot of where that one order
shipped — deleting or editing a saved address must never rewrite a past order's record of
itself. Standard CRUD (`GET/POST /addresses`, `PUT/DELETE /addresses/:id`), scoped to
`req.user.id` with no route accepting a user id as a parameter, matching every other
ownership-scoped module this session.

The one piece of real logic: **exactly one address may be the default at a time**, enforced
server-side inside a transaction (setting a new default first clears the others), not left to
the client to keep consistent. A user's first saved address becomes the default automatically
— there is otherwise no default to fall back to at checkout — and deleting the current default
promotes the next-most-recent remaining address, so there's always a default as long as any
address exists. Verified directly: creating a second address `isDefault: true` correctly
un-defaults the first; deleting the (now-default) second address correctly promotes the first
back to default; a different account's token gets a real `403 FORBIDDEN` when it tries to
delete another user's address.

### Frontend

- **`AccountUtilityPage.jsx`'s `Addresses()`** — real list/add/edit/delete/set-default via
  `api.addresses`. The `.address-item`/`.address-utility` CSS in `ai-assistant.css` had already
  been built for exactly this (list rows with a name/detail line and trailing action buttons)
  and had nothing to render it for, the same pattern found for orders in Sections 29–30. Only
  the add/edit form itself needed new CSS (`.address-form-grid` etc.), since no form existed
  before.
- **`CheckoutPage.jsx`** — Shipping Information now shows saved addresses as selectable cards
  (reusing the existing `.checkout-choice` component already used for shipping/payment method
  selection) with the default pre-selected; picking one skips the manual form entirely, using
  that address's fields as-is rather than copying them into editable state (avoiding the
  sync-fetched-data-via-effect pitfall the pattern established in Section 25's `StoreProfile.jsx`
  warns against). The manual form now only renders for "Use a new address" — chosen explicitly,
  or automatically when the buyer has no saved addresses yet — and its long-standing "Save this
  address for next time" checkbox (present since before this whole sweep, always a no-op) now
  actually calls `api.addresses.create()`, best-effort, before placing the order.

### Verified in the browser

As `customer@mirwal.test`: added a second address ("Dev Customer Home 2," Faisalabad) through
the real form at `/addresses`; the list correctly showed the original ("Dev Customer," Lahore)
still marked Default and the new one with a "Set Default" action instead. At checkout, both
addresses appeared as selectable cards with the default pre-selected and the manual form
correctly hidden; explicitly picking the second (non-default) address and placing the order
produced `Order MW-000003` with `Shipping to: Dev Customer Home 2 · Street 10, Model Town,
Faisalabad` — confirming the picked address, not the default, is what actually gets used.

`npx eslint src server` and `npx vite build` both clean.

---

## Section 32 — Cancellations and returns

The last of the seller panel's honest not-connected pages that a real orders system directly
unblocks: `ReturnsRefunds.jsx` ("This needs a real orders system, which isn't built yet"),
written when that was true. This section builds both halves of it — cancellation and returns —
as two deliberately different flows, because they aren't the same right: cancellation is the
buyer's own call before anything ships, a return needs the seller's review and only makes sense
after delivery.

### Backend

Migration `005_returns.sql` adds a `returned` terminal value to `order_items.status` (distinct
from `cancelled` — one never completed, the other did and came back), and a `return_requests`
table: one row per return attempt, `seller_id` denormalised onto it the same way it is onto
`order_items`, and a unique index on `order_item_id` so a rejected request doesn't quietly allow
a second try (a real dispute-escalation path is future work, not something to silently permit by
accident).

New endpoints, all added to the existing `orders`/`sellers` modules rather than a new one,
matching how seller-scoped order concerns already live in `seller.routes.js`:
- `PATCH /orders/items/:id/cancel` — buyer-only, only while the item hasn't shipped
  (`pending`/`confirmed`/`processing`), restocks the inventory checkout reserved.
- `POST /orders/items/:id/return-request` — buyer-only, only on a `delivered` item with no
  existing request.
- `GET /seller/me/returns`, `PATCH /seller/me/returns/:id/status` — a seller's own review
  queue and resolution action. Approving restocks inventory and marks the item `returned`;
  rejecting leaves it untouched. A request can only ever be resolved once — re-resolving an
  already-resolved request is rejected server-side, not just hidden by disabled buttons.

`GET /orders/:id` (and every other place that shapes an order item) now also returns
`canCancel`/`canRequestReturn` booleans and the item's own `returnRequest`, computed the exact
same way the mutating endpoints themselves decide whether to allow the action — the frontend
never has to independently guess what the server will accept.

Verified directly before touching any frontend: cancelling an item restocks inventory and is
correctly idempotent (cancelling twice fails); a return request is correctly rejected as
`ITEM_NOT_DELIVERED` before delivery and as `RETURN_ALREADY_REQUESTED` on a second attempt;
Seller B's token gets an empty return-request queue and a real `403 FORBIDDEN` when it tries to
resolve Seller A's request; approving a return restocked inventory by exactly the returned
quantity (42 → 44 for a quantity-2 return); resolving an already-resolved request correctly
returns `409 RETURN_ALREADY_RESOLVED`.

### Frontend

- **`OrderConfirmationPage.jsx`** (also the order-detail view linked from `/orders`) — each
  line item now shows a real "Cancel Item" or "Request Return" action when
  `canCancel`/`canRequestReturn` says it's allowed, or the real return status
  (Requested/Approved/Rejected) once one exists. The return-request action opens a small
  inline form (reason + optional description) rather than a separate page, since it's one
  short action, not a multi-step flow.
- **Seller `ReturnsRefunds.jsx`** — both `returns` and `cancellations` types are real. Returns
  is a full review queue (`GET /seller/me/returns`) with real Approve/Reject actions, reusing
  the `.returns-stats`/`.returns-table`/`.request-status`/`.return-actions` CSS in
  `returns-refunds.css`, which had already been built for exactly this and had nothing to
  render it for — the same pattern found repeatedly in Sections 29–31. Cancellations is a
  read-only real view of this store's own cancelled items, filtered client-side from the
  already-real `GET /seller/me/orders` rather than adding a second endpoint for a subset of
  data the first one already returns.

### Bug found and fixed: a legacy click-interceptor was silently overriding real navigation

While verifying "View Details" on the buyer's order list, clicking it always landed on Track
Orders instead of the clicked order's detail page. Cause: `AccountShell.jsx`'s
`handleAccountClick` is a delegated click handler on the whole account-shell wrapper, left over
from when every button in this area was a dead mock control — it matches by button *text* and
navigates by a hard-coded lookup table, entirely independent of whatever real `onClick` a button
now has. `{'View Details': '/track-orders', ...}` was still in that table from before real
orders existed; the button's own (correct) `onClick` fired first, and this parent handler then
immediately fired on the same bubbling click and overwrote the navigation. Fixed by removing
that one entry — the same pattern likely explains a class of "button appears to do something,
but not what you clicked" bugs if this delegated handler is ever extended without checking
whether a label's real component already exists. `'Add New Address'` is still in the same table
and inspection during this fix confirmed it does not break the new real Addresses form (search
params change but the component doesn't remount or reset state on that), but it's an unnecessary
extra navigation worth removing in a future pass if that page is touched again.

### Verified in the browser

As `customer@mirwal.test` on `MW-000001`'s real order-detail page: cancelled the MacBook item
through the real "Cancel Item" button (confirmed its status changed to `cancelled` with no
further actions shown), and the Bose item — already returned via an API-level test earlier in
this section — correctly showed "Return approved" instead of any action buttons. As
`seller.a@mirwal.test`: `/seller-center/orders/returns` showed the real resolved return request
(product, buyer, amount, "Approved," and the resolution note left when it was approved) with
real KPI counts; `/seller-center/orders/cancelled` showed the real cancelled MacBook item. As
`seller.b@mirwal.test`: the same returns page correctly showed zero requests and an honest empty
state — ownership isolation holds through the real UI, matching the direct API check.

`npx eslint src server` and `npx vite build` both clean.

---

## Section 33 — The first automated test suite

Phase 0's audit (§15) listed "automated tests of any kind" under MISSING, and it stayed true
through everything built in Sections 22–32: every security boundary, stock-validation path,
and ownership check in this whole session was verified by hand — real curl calls, real browser
clicks — and none of it was left behind as something that runs again on its own. This section
converts that manual verification into a permanent regression suite.

### Why an integration suite, not mocks

`server/tests/setup.js` spins up a real instance of the Express app (`createApp()`, already
exported for exactly this) on an OS-assigned free port, and every test hits real HTTP routes
against the real dev MariaDB database — the same one `npm run seed` populates. No new
dependency: Node 24's built-in `node:test` and `node:assert/strict` are enough. The reasoning
mirrors this session's own history: the bugs actually found and fixed here (the `/auth/refresh`
crash on a missing cookie, the localStorage RBAC hole from before this session) were bugs in
how real layers — routing, middleware, the database — fit together, not in an isolated
function a mock would have exercised faithfully anyway.

### What's covered (18 tests across 4 files)

- **`auth.test.js`** — the `/auth/refresh`-with-no-cookie regression specifically (asserts a
  clean 401, not a 500); duplicate-email and wrong-password rejection; self-registration only
  ever grants the `customer` role; and the core RBAC assertion from the Phase 0 audit itself —
  a real, validly-signed customer token still gets a real `403` from an admin-only endpoint,
  which is the thing that was never true before this session's Section 22.
- **`orders.test.js`** — checkout rejects a genuinely out-of-stock product and a
  more-than-in-stock quantity (using Dev Store Alpha's Amazfit GTR 4 and Canon EOS,
  respectively — chosen specifically because no other test file or the demo data left over
  from manual browser verification touches them); a valid checkout prices itself server-side
  and decrements real inventory by exactly the right amount; the owning seller can move an
  item forward through the fulfillment state machine and an invalid jump is rejected; a
  different seller can neither see nor modify the item.
- **`returns.test.js`** — cancelling a shipped item is rejected; a return can't be requested
  before delivery; filing one twice is rejected; a non-owning seller can't resolve it; approving
  one restocks inventory by exactly the returned quantity; resolving an already-resolved
  request is rejected. Uses Dev Store Beta's Garmin Forerunner 255 for the same
  no-cross-contamination reason.
- **`addresses.test.js`** — the first saved address becomes the default automatically; exactly
  one address is ever the default; deleting the default promotes the next one; cross-user
  ownership is enforced on both read and write.

### Two real bugs found while building the suite itself

1. **A hung test process, not a slow one.** The first full run of `orders.test.js` appeared to
   hang indefinitely after all four of its tests had already passed. Cause:
   `http.Server.close()` waits for every open connection — including idle keep-alive sockets —
   to end before its callback fires, and Node's built-in `fetch` (undici) reuses persistent
   connections by default without proactively closing them. Fixed by calling
   `server.closeAllConnections()` immediately alongside `close()` in `setup.js`.
2. **A cleanup step that could silently orphan the process.** `orders.test.js`'s `after()` hook
   tried to `DELETE` the throwaway test buyer after the test placed real orders, which
   `fk_orders_buyer`'s `ON DELETE RESTRICT` correctly refuses (Mirwal has no order-deletion
   feature, and a test shouldn't reach around the schema to force one) — a real, correct
   constraint, not a bug. But because that delete threw *before* the hook reached
   `server.close()`/`closePool()`, the server and database pool were never closed at all,
   which reads externally as an unrelated hang rather than as what it was: a cleanup step
   failing and taking the whole teardown down with it. Fixed by not deleting buyers with real
   order history (addresses' throwaway users, which cascade-delete cleanly, still are), and by
   wrapping every file's teardown in `try/finally` so a failure in cleanup can never prevent
   the server/pool from actually closing.

A third, smaller thing worth naming: `node --test tests/` (the directory form, documented as
the normal way to run the whole suite) fails outright on this Windows/Node 24 setup with
`MODULE_NOT_FOUND`, treating the bare directory as a module specifier rather than scanning it.
`package.json`'s `test` script lists each file explicitly instead — see the memory note this
session corrected (`mirwal-verify-all-rate-limits.md` described a `verify:all` script and
`server/index.js` layout from an older, already-replaced backend structure; updated to reflect
the real one).

### Verified

`npm test` (from `server/`) runs all 18 tests in ~10 seconds with a clean exit — no hung
process, no port or rate-limit contention between files (`express-rate-limit`'s in-memory
store is per-process, and `node --test` runs each file as its own process). Re-run individually
per file and together via the full `npm test` command; both clean.

### Not yet covered

This is a foundation, not full coverage: no tests yet for the catalog/products/categories/
brands read endpoints (lower risk — no auth, no mutation, already exercised implicitly by
every other file's setup), the seller `/me/store` and `/me/products` endpoints, or anything on
the frontend (no Vitest/React Testing Library setup exists yet). Extending this suite as new
backend features are built is now the established pattern rather than something to reintroduce
from scratch.

---

## Section 34 — In-app notifications

The last item from §15's MISSING list buildable without something only the user can provide
(a payment gateway needs real merchant credentials; a shipping-cost model needs real business
rates — neither exists yet and neither should be invented). "Notification abstraction" needed
no external dependency: this is in-app only, generated by real events already happening
elsewhere in the app, which is exactly what `AccountUtilityPage.jsx`'s Notifications page and
the seller panel's `SellerNotifications.jsx` were both waiting on ("Order and account
notifications will appear here once that system is built" / "will appear here once those
systems are built").

### Backend: `server/src/modules/notifications/`

New `notifications` table (migration `006`): recipient, a machine-readable `type`, title/body,
an optional `link`, and `read_at`. `createNotification(userId, {...}, connection?)` accepts an
optional transaction connection so a notification can be inserted atomically alongside the
event that caused it — a new order and its two notifications (buyer + each distinct seller
involved) either all commit or none do, inside `createOrder`'s existing transaction.

Real events wired into `orders.service.js`, the only place order/return state actually
changes:
- **`createOrder`** → notifies the buyer ("Order placed") and, once per distinct seller in a
  multi-seller cart (not once per line item), each seller ("New order received").
- **`updateOrderItemStatusForSeller`** → notifies the buyer with the specific new status
  ("your order is on its way," etc.).
- **`cancelOrderItemForBuyer`** → notifies the seller a buyer cancelled before shipment.
- **`createReturnRequestForBuyer`** → notifies the seller a return was requested, with the
  buyer's stated reason.
- **`resolveReturnRequestForSeller`** → notifies the buyer the return was approved or
  rejected, including the seller's resolution note if one was given.

`GET /notifications` (most recent 50), `PATCH /notifications/:id/read`,
`PATCH /notifications/read-all` — all scoped to `req.user.id`, the same ownership pattern as
every other module. Verified directly: placing a real order produced exactly one real
notification for the buyer and one for the seller, atomically, in the same transaction; a
status change produced a real buyer notification with the correct new status; a different
user's token gets a real `403` trying to mark someone else's notification read.

### Frontend

- **`AccountUtilityPage.jsx`'s `Notifications()`** — real list via `GET /notifications`, an
  icon per event type, a "Mark all as read" action, and clicking a notification marks it read
  and follows its real `link` (e.g. straight to the relevant order).
- **Seller `SellerNotifications.jsx`** — same real data, reusing the
  `.seller-notification-row`/`.seller-notification-list`/`unread` CSS in
  `seller-notifications.css`, which — the same pattern found repeatedly since Section 29 — had
  already been built for exactly this and had nothing to render it for.

### A real bug found and fixed during browser verification

The seller page's "View" and "Mark read" buttons both called the same `openNotification`
handler, which marks read *and* navigates to the notification's link if one exists. Clicking
"Mark read" therefore also navigated away — verified concretely: after clicking "Mark read"
once, `window.location.pathname` had silently changed to `/seller-center/orders` and the
notifications list (rendered on a completely different page) understandably showed zero
unread rows, which without checking the URL could easily have been misread as "marking one
notification read marked all of them read." Fixed by giving "Mark read" its own handler that
only calls `PATCH .../read`, with no navigation — re-verified afterward: the URL stayed on
`/seller-center/notifications` and exactly one row's unread state cleared.

### Verified

Real notifications observed end-to-end for both roles: after placing an order and moving it
through a status change via the actual UI, the customer's `/notifications` page showed both
the "Order placed" and "Order ... is now confirmed" notifications with correct content, and
seller.a's `/seller-center/notifications` showed the matching "New order" and (from a separate
cancellation) "item cancelled" notifications — each with working, real "Mark read" actions.

`npx eslint src server`, `npx vite build`, and the full `npm test` suite (still 18/18) all
clean.

### Also this session: recovering a stopped local dev environment

Partway through this section, the API server and the project's portable MariaDB instance were
both found stopped (a `curl` to `/health` refused the connection, and no `mysqld`/`node`
processes were running at all). `docs/DATABASE.md` §5 already documented the exact recovery
command for the portable dev database — restarted from that, migrations re-applied cleanly,
and all prior session data (orders, addresses, return requests) was intact, confirming the
portable install genuinely persists to disk across a stop/start cycle the way it's meant to.

While using it, found and fixed a real, unrelated defect in that same doc section: every
backslash in its Windows paths and the startup command had been silently dropped
(`D:mirwal-devdbmariadb-...` instead of `D:\mirwal-devdb\mariadb-...`), making the documented
command uncopyable as written — almost certainly from whatever originally generated the file
interpreting `\b`/`\m`/etc. as escape sequences (one instance had literally become an embedded
backspace control character, not just a missing backslash). Fixed directly in
`docs/DATABASE.md`.

---

## Section 35 — Payments: card, EasyPaisa and JazzCash

Migration 003 deliberately shipped `payment_method` as `ENUM('cod')` with a single value,
because offering "Online Payment" with no gateway behind it would have been a fabricated
capability — the exact thing this whole audit exists to remove. Real credentials are now
available, so this builds the real thing: card via Stripe, plus Pakistan's two dominant
mobile wallets as separate direct integrations.

### Two rules the design enforces

1. **Mirwal never sees a card.** No card number, CVV, expiry or wallet PIN is stored, logged,
   or even received by the server. Stripe.js is loaded from Stripe's own CDN (a PCI
   requirement — it cannot be bundled) and collects the card directly into Stripe from the
   shopper's browser. The only card data Mirwal holds is brand and last four digits, read off
   the confirmed PaymentIntent, for display. This is what keeps Mirwal out of PCI-DSS scope.
2. **Only a signature-verified provider callback marks an order paid.** The browser returning
   to a success URL proves nothing — a shopper can navigate straight to it, and 3-D Secure
   redirects the browser away mid-payment anyway. `settleAttempt()` is the single place
   `payment_status` becomes `'paid'`, and it is only reachable from a verified webhook.

### Schema (migration `007_payments.sql`)

`payment_attempts` — one row per *attempt*, not per order: a declined card followed by a
successful JazzCash payment produces two rows, and the failure is real history worth keeping.
A unique key on `(provider, provider_ref)` is the idempotency anchor. `payment_webhook_events`
records every inbound callback keyed by the provider's own event id, so a provider retry (all
three retry on any non-2xx) collides on that unique key and is skipped rather than
double-applying a payment.

Two further guards in `settleAttempt`: a callback for a reference Mirwal never created is
ignored outright, and a provider reporting a different amount than Mirwal asked to charge is
recorded as a failure rather than silently accepted (compared in minor units, so float drift
can't cause a false mismatch).

### Provider adapters

- **Stripe** (`providers/stripe.js`) — PaymentIntents. Signature verification uses Stripe's
  own `webhooks.constructEvent`, deliberately rather than hand-rolling it: it does
  timing-safe comparison and replay-window checks that are easy to get subtly wrong. This is
  why the SDK was added as a dependency.
- **JazzCash** (`providers/jazzcash.js`) — hosted "Page Redirection" checkout. HMAC-SHA256 over
  the sorted, ampersand-joined non-empty `pp_*` values, keyed by the merchant integrity salt.
- **EasyPaisa** (`providers/easypaisa.js`) — hosted gateway. HMAC over a `key=value` string in
  the spec's own fixed (non-alphabetical) field order — a detail that is easy to "tidy" into
  breakage, so it's called out in the code.

**Accuracy caveat, stated plainly:** the EasyPaisa and JazzCash adapters were written from
their publicly documented specs as I understand them, without access to your merchant
integration sheets. Stripe's is well-established and I'm confident in it; the two wallets are
the ones to sandbox-verify first. If either gateway rejects a request, the hash construction
in `signature()` is the first thing to check against their integration document.

### Configuration

Every provider is **optional and independently enabled** — `env.js` deliberately does not use
`required()` here. An unconfigured gateway must not stop the server booting: Cash on Delivery
has always worked without any of this, and a developer shouldn't need live payment
credentials to run the app locally. `GET /payments/methods` reports exactly which methods are
actually configured, and `assertMethodAvailable()` re-checks server-side at checkout, so a
client cannot select its way into a payment path that doesn't exist.

Credential names are documented in `server/.env.example` (which is committed) while the real
values go in `server/.env` (which is git-ignored — verified). No secret was entered into or
seen in this session.

### Verified

- `GET /payments/methods` with no credentials configured: COD `available: true`, the three
  gateways `available: false` — and a test asserts the response contains no `sk_test`,
  `hashKey`, `integritySalt` or `secretKey` substring, so the endpoint can't leak a
  credential as it grows.
- Checkout with an unconfigured method is rejected `400 PAYMENT_METHOD_UNAVAILABLE`; COD
  checkout still works unchanged.
- Forged callbacks — a JazzCash post claiming `pp_ResponseCode=000` with a junk hash, and a
  Stripe webhook with a junk signature — both rejected `400 INVALID_SIGNATURE`, with the
  order confirmed still `pending` afterward.
- Temporarily added placeholder Stripe keys to confirm the checkout UI flips "Debit / Credit
  Card" to a real selectable option and correctly narrows the unavailable notice to
  "EasyPaisa, JazzCash". Placeholders then removed and the honest state re-verified.
- Backend suite extended to 27 tests (from 18), adding `notifications.test.js` and
  `payments.test.js`; all pass. `npx eslint src server` and `npx vite build` clean.

### What still needs you

The integration is built but **not yet proven against a real gateway** — that needs sandbox
credentials in `server/.env` and one real test transaction per provider. Specifically:

1. Add your sandbox keys to `server/.env` (names are in `.env.example`).
2. For Stripe, run `stripe listen --forward-to localhost:4000/api/v1/webhooks/stripe` and put
   the printed signing secret in `STRIPE_WEBHOOK_SECRET`.
3. For the wallets, register the callback URLs `…/api/v1/webhooks/easypaisa` and
   `…/api/v1/webhooks/jazzcash` in each merchant portal — these need a publicly reachable
   host, so a tunnel (ngrok or similar) is required for local testing.
4. Run one sandbox transaction per provider and confirm the order flips to `paid` **from the
   webhook**, not from the browser redirect.

Refunds were also still unbuilt at the end of this section — addressed immediately after, in
Section 36.

---

## Section 36 — Refunds

Section 32 built returns: approving one marks the item `returned` and restocks it. What it
never did was move money back. This closes that gap.

### Honest automation boundaries

Not every refund can be automated, and the schema says so rather than pretending:

| Payment method | Refund path |
|---|---|
| Card (Stripe) | **Automated.** Stripe's refunds API is called directly and its result is authoritative. |
| EasyPaisa / JazzCash | **`manual_required`.** Both expose refund APIs, but they need merchant-portal-enabled permissions and their exact contracts weren't available (same caveat as the payment adapters). Automating a money-*out* call I can't verify risks double-refunding or failing silently. |
| Cash on Delivery | **`manual_required` by definition.** The cash was collected by the courier; there is no gateway to reverse. |

`manual_required` is a real state a human resolves — Mirwal records exactly what is owed to
whom, tells the seller *how* to pay it, and waits for them to confirm. It is deliberately not
a euphemism for "failed", and never a fake success.

### Design details worth naming

- The refund row is created **inside** the return-approval transaction, so an approved return
  can never end up owing nothing. The gateway call happens **after** commit — an external API
  call must not hold a database transaction open, and a gateway failure then leaves a
  retryable row rather than rolling back the approval alongside it.
- A `UNIQUE KEY` on `return_request_id` means one return can only ever owe one refund. The
  application already refuses to re-resolve a return, but money-out deserves the constraint
  at the storage layer too, not only in application logic.
- Stripe refunds pass an `idempotencyKey` derived from the refund's own `public_id`, so a
  retry after an ambiguous network failure cannot pay a buyer twice.
- A gateway failure moves the refund to `manual_required` rather than retrying automatically.
  Repeated blind money-out attempts against an unclear failure is exactly how double refunds
  happen.
- An order is only marked `refunded` when the refund covers its whole total; a partial refund
  on a multi-item order leaves the order itself `paid`.

### A real bug this surfaced: COD orders were never marked paid

The first end-to-end test produced an *empty* refund queue for a delivered, returned COD
order. The cause was a genuine pre-existing gap, not a bug in the new code: **nothing ever
marked a COD order paid.** `payment_status` stayed `'pending'` forever, because the only code
that set `'paid'` was the payment-webhook path, which COD never touches. The new refund logic
then correctly concluded that an unpaid order owed nothing back.

But for cash on delivery, *delivery is the payment event* — the courier collects the cash at
the door. Fixed in `updateOrderItemStatusForSeller`: when an item reaches `delivered` on a COD
order and no live items remain outstanding, the order is marked paid. The "no live items
outstanding" check matters so a partly-delivered multi-seller order isn't called paid early.

Worth noting this was invisible before now — COD orders simply displayed as unpaid forever and
nothing depended on it. Building refunds is what made it consequential.

### Endpoints

`GET /payments/refunds` (a buyer's own), `GET /seller/me/refunds` (a seller's manual queue,
scoped to their own store's returns), `PATCH /seller/me/refunds/:id/settle` (seller confirms
they paid out-of-band). The seller UI surfaces the queue at the top of Returns & Refunds with
the specific instruction per refund, and a "Mark refunded" action.

### Verified

- A COD order walked to `delivered` now reads `paymentStatus: paid`; approving a return on it
  creates a `manual_required` refund carrying a real instruction.
- Ownership holds: Seller B cannot see or settle Seller A's refund (`403`), settling twice is
  `409`, and a fresh account sees an empty refund list.
- After settling, the order reads `refunded`.
- Browser: the seller's queue rendered both pending refunds with their instructions; clicking
  "Mark refunded" settled exactly one (2 → 1) and stayed on the page.
- Backend suite now 30 tests (from 27), adding `refunds.test.js`. All pass; `npx eslint src
  server` and `npx vite build` clean.

### Still outstanding

Automated wallet refunds remain unbuilt pending EasyPaisa/JazzCash refund API access — the
manual path is the honest interim, not a placeholder to rip out. And as with Section 35, none
of the gateway paths are proven against a live sandbox yet; that still needs credentials and
one real transaction per provider.

---

## Section 37 — Phase 3: Bootstrap removal

§19.4 flagged this as measured, not guessed: the actual Bootstrap dependency was four
dropdowns, `.btn` on two buttons that already carried project styling, one checkbox, and
`.btn-primary`/`.btn-secondary` outside the seller pages that define their own richer
versions. Everything else with a Bootstrap-looking class name — `.container`, `.dropdown-menu`,
`.dropdown-item`, `.modal-*`, `.card`, `.row` — was already fully styled by the project's own
CSS and only borrowed the name.

### What was built

- **`Dropdown.jsx`** — a small reusable component replacing `data-bs-toggle="dropdown"`,
  reproducing the *behaviour* Bootstrap provided, not just the look: click-outside to close,
  Escape to close **and return focus to the toggle**, and a real `aria-expanded` (the old
  markup hard-coded `aria-expanded="false"` even while open — screen readers were told the
  opposite of the truth). Used for all four dropdowns in `Header.jsx`.
- **`styles/bootstrap-replacements.css`** — only the base layer Bootstrap was actually
  supplying: dropdown positioning/z-index/list-reset, a minimal `.btn` reset plus
  `.btn.btn-primary`/`.btn.btn-secondary` (compound selector, so it never outranks
  `store-profile.css`'s own richer versions), and `.form-check-input`'s checkbox sizing.
  Imported in Bootstrap's old slot in `main.jsx` so cascade order is unchanged.
- Removed the `bootstrap` package entirely.

### Verified, not assumed

Before touching anything, snapshotted computed styles (font, size, line-height, colour,
margin, background, radius) of `body`/`h1`/`h2`/`p`/`button`/`input`/`label`/`strong`/`small`
on the homepage. After removal, re-ran the same snapshot: identical except a `sr-only`
(visually hidden) `h1` whose font-size doesn't matter to anyone. Every genuinely visible
heading matched exactly — the project's own typography was already winning the cascade,
Bootstrap's Reboot wasn't silently load-bearing here.

Then, functionally, for all four dropdowns: open via a realistic pointerdown→mousedown→
pointerup→mouseup→click sequence (a bare `.click()` doesn't exercise the same path and
initially gave a false negative), confirmed real positioning (`position: absolute`, correctly
below the toggle, right-aligned for the account menu's `dropdown-menu-end`), Escape closing
the menu and returning focus to the toggle, click-outside closing it, and selecting an item
both firing its handler and auto-closing the menu — the location dropdown's "Karachi" case
updated the visible label and closed correctly. Also spot-checked the two non-dropdown
casualties: `.form-check-input` (correct 10px checkbox with the project's accent orange) and
`.add-to-cart.btn` (correct background/color/cursor), and confirmed no horizontal overflow was
introduced anywhere on the homepage.

Seller pages using `.btn-primary`/`.btn-secondary` (`StoreProfile.jsx`) were checked
separately and correctly still render `store-profile.css`'s own 36px/orange-tint/6px-radius
styling, not the generic replacement — confirming the compound-selector scoping worked as
intended.

### Result

| | Before | After | Saved |
|---|---|---|---|
| Main CSS bundle | 600 KB (93 KB gzip) | 371 KB (62 KB gzip) | 229 KB |
| Main JS bundle | 635 KB (176 KB gzip) | 555 KB (153 KB gzip) | 80 KB |
| **Total** | | | **~308 KB**, matching §19.4's ~310 KB estimate |

`npx eslint src server` clean, `npx vite build` clean, and the full backend suite (30/30,
unaffected — this was a frontend-only change) still green.

---

## Section 38 — Code-splitting the public/customer pages

Immediate follow-on to Section 37: with Bootstrap gone, the build still warned about a >500 KB
chunk. The cause was measured, not guessed, the same way Section 37 started: every admin page
(31 files) and every seller page (18 files) was already behind `lazy()` — a pattern established
back in Sections 21/26 for unrelated reasons (route-collision cleanup) — but **every
public/customer page was still a static import**. HomePage, ProductPage, CartPage,
CheckoutPage, AuthPage, PayPage (which pulls in the Stripe SDK), and about 20 others were all
bundled into the one chunk every visitor downloaded before anything could render, regardless
of which single page they'd actually landed on.

### Fix

~25 imports converted to `lazy(() => import(...))`, matching the exact pattern already proven
47 times for admin/seller pages. Two needed the named-export wrapper form, since `lazy()` only
accepts a default export:

```js
const TrustRoute = lazy(() => import('./TrustPage').then((m) => ({ default: m.TrustRoute })))
```

No new `<Suspense>` boundary was needed — one already wraps the entire `<Routes>` tree. Left
eager: `Header`, `Footer`, `RouteMeta`, `SellerLayout` (shared chrome rendered on every page
regardless of route), `SessionProvider`/`ComparisonProvider` (context needed before any route
can render), and small inline pieces (`AddToCartModal`) — none of which benefit from deferral
the way a whole page component does.

### Result

| | Before | After | Saved |
|---|---|---|---|
| Main JS bundle | 555 KB (153 KB gzip) | 289 KB (87 KB gzip) | 266 KB |
| Main CSS bundle | 371 KB (62 KB gzip) | 187 KB (33 KB gzip) | 184 KB |
| **Combined with Section 37** | 635 KB JS / 600 KB CSS | 289 KB JS / 187 KB CSS | **~760 KB**, better than half of each |

### Verified

Before touching anything, computed styles for `body`/`h1`/`h2`/`p`/`button`/`input`/`label`/
`strong`/`small` were snapshotted as a regression baseline — re-checked identical afterward,
with one apparent difference (`h1` 40px→30px) traced to an `.sr-only` (visually hidden)
heading, not a real change; every genuinely visible heading matched exactly.

In the browser, with the whole local stack cold-started from scratch (see below): the home
page, `/cart`, and `/product/:slug` all rendered correctly as separate lazy chunks; the four
Bootstrap-replacement dropdowns (Section 37) still opened correctly after the full reload;
signing in as `admin@mirwal.test` and crossing into `/admin/orders` — a jump across two
different lazy-loaded route trees — rendered the real order list with no errors. `npx eslint
src server` and `npx vite build` clean.

### Also this session: the local dev stack had stopped again, plus a real launch.json bug

Same recovery as Section 34 — MariaDB and the API server were both found stopped between
turns, restarted from `docs/DATABASE.md`'s documented command. This time Vite was down too,
and starting it via the project's own `.claude/launch.json` failed outright:
`'C:\Program' is not recognized as an internal or external command`. Cause: the same class of
backslash-corruption bug fixed in `docs/DATABASE.md` (Section 34) — `"runtimeExecutable":
"C:\PROGRA~1\nodejs\node.exe"` is invalid JSON-as-written, because `\n` inside a JSON string
is a real newline escape, silently splitting the path. Fixed by pointing it at plain `"node"`
(already on PATH, and how every other command in this project invokes it) rather than
hand-rolling an absolute path prone to exactly this mistake again.
