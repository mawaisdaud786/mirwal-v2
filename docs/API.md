# MIRWAL — API

**Base:** `/api/v1` · **Status:** Phase 0.5 foundation implemented and verified locally.

Every endpoint below is implemented and was exercised against a real MariaDB 10.11.16
instance. Nothing in this document describes a planned endpoint — planned work is in §6.

---

## 1. Response envelope

Success:

```json
{ "success": true, "data": { }, "message": "optional" }
```

Paginated success — `data` carries `items` plus `pagination`:

```json
{ "success": true,
  "data": { "items": [], "pagination": { "page": 1, "pageSize": 24, "total": 35, "totalPages": 2, "hasNext": true } } }
```

Failure:

```json
{ "success": false,
  "error": { "code": "PRODUCT_NOT_FOUND", "message": "Product not found." },
  "requestId": "90a493a9-3a23-4a02-a215-4948f3b34ea3" }
```

`code` is stable and safe to branch on. `message` is safe to show a user. `requestId` is
echoed in the `X-Request-Id` response header and written to the server log, so a user can
quote it without the response ever carrying a stack trace, SQL text or file path.
**Verified:** 404, duplicate-key and malformed-JSON responses were checked for leakage of
stack frames, SQL, driver codes, `node_modules` and Windows paths — none present.

### Error codes

| Code | HTTP | Meaning |
|---|---|---|
| `VALIDATION_FAILED` | 400 | Body/query failed schema validation; `error.details[]` lists fields |
| `INVALID_JSON` | 400 | Body was not valid JSON |
| `UNAUTHENTICATED` | 401 | No token, or token invalid/expired |
| `INVALID_CREDENTIALS` | 401 | Wrong email or password (identical for unknown email — no enumeration) |
| `TOKEN_EXPIRED` / `TOKEN_INVALID` | 401 | Access token rejected |
| `REFRESH_INVALID` / `REFRESH_REUSED` | 401 | Refresh token expired, or replayed after rotation |
| `FORBIDDEN` | 403 | Authenticated but not permitted |
| `SELLER_NOT_ACTIVE` | 403 | Seller account pending, suspended or closed |
| `ACCOUNT_LOCKED` / `ACCOUNT_SUSPENDED` | 403 | Login blocked |
| `PRODUCT_NOT_FOUND`, `CATEGORY_NOT_FOUND`, `SELLER_NOT_FOUND`, `ROUTE_NOT_FOUND` | 404 | |
| `EMAIL_TAKEN`, `ALREADY_EXISTS`, `IN_USE` | 409 | Uniqueness / referential conflict |
| `PAYLOAD_TOO_LARGE` | 413 | Body over 1 MB |
| `RATE_LIMITED` | 429 | Too many requests |
| `INTERNAL_ERROR` | 500 | Unexpected; logged in full server-side |
| `SERVICE_UNAVAILABLE` | 503 | Database unreachable |

---

## 2. Authentication

Access token: short-lived JWT (default 15m) in `Authorization: Bearer <token>`. It carries
the user's roles and permissions, all written by the server.

Refresh token: opaque random string in an **httpOnly** cookie (`mirwal_rt`), so XSS cannot
read it. Only a SHA-256 hash is stored. Rotated on every use; replaying a rotated token
revokes **all** of that user's sessions. **Verified.**

| Method | Path | Auth | Notes |
|---|---|---|---|
| `POST` | `/auth/register` | — | Creates a **customer** only. Cannot mint seller/admin. Rate limited. |
| `POST` | `/auth/login` | — | Returns `{ user, accessToken }`, sets refresh cookie. Rate limited (10/min, successes not counted). |
| `POST` | `/auth/refresh` | cookie | Rotates the refresh token, returns a new access token. |
| `POST` | `/auth/logout` | cookie | Revokes the refresh token and clears the cookie. |
| `GET` | `/auth/me` | Bearer | Current user, roles and permissions. |

```jsonc
// POST /auth/login  -> 200
{ "success": true,
  "data": {
    "user": { "id": "<uuid>", "email": "...", "fullName": "...", "roles": ["customer","seller"],
              "permissions": ["catalog.product.read", "..."] },
    "accessToken": "eyJ..." },
  "message": "Signed in." }
```

Login failures increment a counter and lock the account for 15 minutes after 8 failures.
Unknown-email responses spend comparable time to real ones so timing does not reveal
whether an account exists.

---

## 3. Public catalog

No authentication. Only `status = 'active'` products are ever returned; draft,
pending-review, rejected and archived products are invisible to the storefront.

| Method | Path | Notes |
|---|---|---|
| `GET` | `/products` | Faceted, paginated listing |
| `GET` | `/products/:slug` | Single product incl. variants |
| `GET` | `/categories` | Nested tree with live product counts |
| `GET` | `/categories/:slug` | Category detail + SEO metadata |
| `GET` | `/brands` | Brands with live product counts |
| `GET` | `/sellers` | Approved stores only |
| `GET` | `/sellers/:slug` | Public storefront detail |

### `GET /products` query parameters

Deliberately mirrors what `ExplorePage` already sends, so the existing UI can be pointed at
this without redesign.

| Param | Type | Notes |
|---|---|---|
| `q` | string | Full-text over name, subtitle, description (InnoDB FULLTEXT, prefix-boolean) |
| `category` | csv of slugs | `electronics,fashion` |
| `brand` | csv of slugs | |
| `seller` | slug | |
| `minPrice`, `maxPrice` | number | Validated so min ≤ max |
| `rating` | 0–5 | Minimum average |
| `availability` | `in-stock` \| `all` | |
| `sort` | `recommended` \| `newest` \| `price-low` \| `price-high` \| `rating` | |
| `page` | int ≥ 1 | |
| `pageSize` | int 1–60 | Capped so the whole catalogue cannot be pulled in one request |

### Money

Money never crosses the boundary as a float. `mysql2` returns `DECIMAL` as a string and it
stays a string; the API adds a preformatted display value:

```json
"price": { "amount": "202000.00", "currency": "PKR", "display": "Rs 202,000" },
"compareAtPrice": { "amount": "234000.00", "currency": "PKR", "display": "Rs 234,000" },
"discountPercent": 14
```

`discountPercent` is **derived**, not stored. A discount exists only when
`compare_at_price > price`, enforced by a database CHECK — the inverted-price bug from the
audit (an item listed at 234,000 "reduced from" 202,000 with a `-30%` badge) is now
impossible to represent.

### Availability

```json
"availability": { "inStock": true, "lowStock": false }
```

The exact stock count is deliberately **not** exposed: it invites scraping, and the audit
found the UI hard-coding "Only 8 items left!" as false urgency on every product.

### Ratings

```json
"rating": { "average": 4.8, "count": 1200 }
```

Derived from real review rows only. Zero reviews reads as `0`, never a flattering default.

---

## 4. Seller (scoped)

Requires a signed-in user whose account has an **approved** seller record.

| Method | Path | Permission |
|---|---|---|
| `GET` | `/seller/me/store` | seller role |
| `GET` | `/seller/me/products` | `catalog.product.read` |

**There is deliberately no endpoint that accepts a seller id as a parameter.** Every query
filters on the seller resolved from the authenticated user's own record, so "read another
seller's data" is not a request that can be expressed. Holding the `seller` role means
"may manage my own store", never "may manage any store".

**Verified:** Seller A returns 18 products, Seller B returns 17, with zero overlap.

---

## 5. Verified authorization boundaries

All twelve pass:

| Case | Result |
|---|---|
| Unauthenticated → seller panel | `UNAUTHENTICATED` |
| Customer → seller panel | `FORBIDDEN` |
| Admin → seller panel (no implicit seller context) | `FORBIDDEN` |
| Seller → own seller panel | `OK` |
| Garbage bearer token | `UNAUTHENTICATED` |
| Forged unsigned JWT (`alg: none`) | `UNAUTHENTICATED` |
| Wrong password | `INVALID_CREDENTIALS` |
| Unknown email | `INVALID_CREDENTIALS` (identical — no enumeration) |
| Invalid email / short password on register | `VALIDATION_FAILED` |
| Unknown product / unknown route | `PRODUCT_NOT_FOUND` / `ROUTE_NOT_FOUND` |
| Refresh token replayed after rotation | `REFRESH_REUSED`, all sessions revoked |

---

## 6. Not yet implemented

Deferred to later phases, listed so this document is not mistaken for a complete API:

Cart, checkout and orders (server-controlled — Phase 10) · payments · shipping · returns
and refunds · wishlist · addresses · reviews (write) · seller product create/update/delete ·
inventory adjustment · admin endpoints of any kind · analytics · AI · notifications ·
password reset and email verification · file uploads.

`src/services/api.js` in the frontend drafts several of these. It remains an unwired
contract; only the endpoints listed in §2–4 exist.
