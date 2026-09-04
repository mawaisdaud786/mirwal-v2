# MIRWAL — Marketplace Production-Readiness Gap Audit

**Date:** 4 September 2026
**Scope:** Admin Panel, Seller Panel, Customer Storefront, API, database schema (migrations 001–019)
**Method:** Read-only static inspection of `server/src` (19 migrations, ~50 tables, 13 route modules, ~190 endpoints), `apps/admin`, `apps/seller`, `apps/storefront`. No code or schema was modified.
**Related:** `docs/PROJECT_AUDIT.md` (Phase 0, Aug 2026) — this document supersedes its gap lists and assumes its remediation landed.

Severity labels used throughout:
🔴 **CRITICAL** — must have before launch · 🟠 **HIGH** — should have before/around launch · 🟡 **MEDIUM** — shortly after launch · 🟢 **LOW** — future enhancement

---

## 1. CURRENT SYSTEM ASSESSMENT

### 1.1 What is genuinely built — do not rebuild any of this

The backend is not a shell. It is a disciplined, well-commented Express + MariaDB application with an unusually honest engineering culture (fabricated UI was deliberately deleted rather than left as decoration). The following are **complete and production-grade**:

| Area | Evidence |
|---|---|
| **Schema discipline** | `DECIMAL(12,2)` money everywhere, never float. `CHECK` constraints on price/rating/quantity/inventory. `ck_products_compare_at` makes an inverted discount unrepresentable. FKs with deliberate `RESTRICT`/`SET NULL`/`CASCADE` choices. `public_id CHAR(36)` separate from auto-increment ids. utf8mb4 enforced at the database level with a cPanel latin1 guard in the migration runner. |
| **Migration runner** | Forward-only, checksummed, refuses an edited-after-applied migration, `$$` block aware, no-transactional-DDL caveats documented (`server/src/db/migrate.js`). |
| **Authentication** | scrypt with self-describing hash, refresh-token rotation with `replaced_by_id` reuse detection, SHA-256 token storage, httpOnly cookie, `failed_login_count` + `locked_until` lockout, TOTP 2FA with hashed single-use backup codes, password resets (migration 019). Per-app scoped login (`/admin/auth`, `/seller/auth`). |
| **RBAC** | `roles` / `permissions` / `role_permissions` / `user_roles`, `requirePermission()` on essentially every admin route, `requireRole('super_admin')` on backups and security policy. |
| **Audit logging** | `audit_logs` with actor, action, entity, JSON metadata, IP, request id, and 68 call sites covering admin mutations. |
| **Payments** | Stripe + EasyPaisa + JazzCash. Webhook router mounted **before** `express.json()` so Stripe raw-body signatures verify, and **before** the rate limiter so provider retries are never throttled. `payment_webhook_events` unique on `(provider, event_id)` for idempotency; `payment_attempts` unique on `(provider, provider_ref)`. Amount re-derived server-side. Order marked paid only by verified callback. |
| **Refunds** | `manual_required` is a real, truthful state for COD rather than a euphemism for failure. `uq_refunds_return_request` makes double-refund impossible at storage level. |
| **Payouts** | `uq_payout_items_item` makes double-paying an order item impossible at storage level. Commission stored on the payout row, not recomputed on read. |
| **Product moderation lifecycle** | `draft → pending_review → active/rejected/archived`. A seller can **never** set `active`. Editing a live listing forces it back to `pending_review` (`products.service.js:227`) — the correct anti-bait-and-switch rule, already implemented. |
| **Review integrity** | `product_reviews.order_item_id` is `NOT NULL` **and** `UNIQUE`. Verified purchase is enforced by the database, not by application logic. There is no code path to an unverified review. |
| **Document storage** | Magic-byte type detection (not Content-Type, not extension), generated stored filenames, `path.resolve` traversal guard on every read, storage outside any web root, SHA-256 checksum, authenticated-only download. `server/src/lib/storage.js` is the best file in the repo. |
| **AI grounding** | `ai.service.js` retrieves real catalogue rows and assembles prose *from those rows' own fields*. The model never authors a price, rating or stock level. Correct architecture. |
| **Other real subsystems** | Shipping zones/methods/warehouses, search telemetry (`search_queries` incl. zero-result and click-through), `system_logs` fed by the real error handler, `backup_runs`, maintenance mode middleware, support tickets with staff-only internal notes, product attributes, marketing CRUD, in-app notifications. |

### 1.2 The honest summary

Mirwal is **a strong single-seller-ish e-commerce backend with marketplace-shaped tables**. What is missing is almost entirely the *marketplace trust layer*: the parts that exist because sellers are strangers and some of them are adversaries.

Three findings are structural rather than cosmetic:

1. **There is no way to become a seller.** `INSERT INTO sellers` appears exactly once in the entire codebase — in `server/src/db/seed.js`. The storefront application form (`SellerFormPage.jsx`) is fifteen lines whose `submit()` handler is `setSubmitted(true)`. Admin "Applications", "Verification" and "Store Applications" pages review a queue that nothing can ever populate in production.
2. **Seller-status enforcement is single-layered, and the layer has a hole.** `suspendSeller()` *does* archive the seller's active products in the same transaction, and `reinstateSeller()` restores them — that part is correct and should not be rebuilt. But the public catalogue query never joins on `sellers.status` or `sellers.deleted_at`, so enforcement depends entirely on that one write succeeding. `setProductApproval()` does not check the seller's status either, so approving a suspended seller's queued product puts it straight back on the storefront. Rejected, closed and soft-deleted sellers are not archived at all.
3. **Enforcement has nowhere to land.** There is no trust score, no violation record, no penalty, no appeal, no dispute escalation, and no seller-facing communication of any decision. "Disputes" is a read-only `SELECT` over `return_requests` with no admin action of any kind (`disputes.service.js` says so in its own header comment).

**Verdict:** the transactional core is launch-quality. The trust, safety and onboarding layer is roughly 20% built. Mirwal cannot onboard a real Pakistani seller today, and cannot police one tomorrow.

---

## 2. CRITICAL MISSING FEATURES

These twelve gate launch. Each is verified against source, not inferred.

| # | Gap | Evidence | Sev |
|---|---|---|---|
| 1 | **No seller onboarding pipeline.** No `seller_applications` table, no `POST /seller/apply`, no admin "create seller". Storefront apply form is decorative. | `SellerFormPage.jsx:13`; `grep "INSERT INTO sellers"` → `seed.js` only | 🔴 |
| 2 | **No defence-in-depth on seller status.** Suspension archives products correctly, but the catalogue query never checks `sellers.status`/`deleted_at`, and `setProductApproval()` can republish a suspended seller's product. | `catalog.service.js:134, 243`; `admin/catalog.service.js:298` | 🟠 |
| 3 | **No KYC data model.** `sellers` has no `seller_type`, CNIC, NTN, business registration number, date of birth, address, or bank account. Documents can be uploaded but there is nothing to check them *against*. | `002_catalog.sql:39`; `017_..._documents.sql:91` | 🔴 |
| 4 | **Seller cannot upload verification documents from the panel.** The endpoint (`POST /seller/me/documents`) and the storage layer exist; `apps/seller/src/api.js` exposes only `list` and `remove`. | `apps/seller/src/api.js:125-128` | 🔴 |
| 5 | **Seller cannot edit their own store.** Only `GET /seller/me/store` exists. No `PATCH`. No logo/banner upload. `StoreProfile.jsx` (605 lines of form) cannot save. | `seller.routes.js:30`; `StoreProfile.jsx` | 🔴 |
| 6 | **Coupons and promotions are never applied.** `orders.service.js` contains zero references to coupons. `coupon_redemptions` can never gain a row. Checkout has no code field. | `grep coupon server/src/modules/orders/` → empty | 🔴 |
| 7 | **Transactional email is half-wired.** `messaging.send()` is genuinely called for password reset/changed, product approved/rejected, seller approved/rejected, document reviewed and order refunded. But `order.confirmation`, `order.shipped` and `order.otp` are defined templates with **no caller**, and there is no verification email, no payout mail and no SMS anywhere. | `grep 'messaging.send'` → 8 sites | 🔴 |
| 8 | **Email and phone are never verified.** `email_verified_at` is written only by `seed.js`. `phone_verified_at` is never written at all. | `grep email_verified_at server/src` | 🔴 |
| 9 | **No shipment or tracking entity.** No `shipments` table, no tracking number, no carrier, no `failed_delivery` status. "Shipped" is a status with no shipment behind it. | migrations 003/005/018 | 🔴 |
| 10 | **Shipping is hard-coded free.** `const shippingFee = 0` in order creation, despite `shipping_zones` / `shipping_methods` existing and a public quote endpoint being live. | `orders.service.js:184` | 🔴 |
| 11 | **No dispute system.** Admin "Disputes" is a read-only view of return requests. An admin cannot overturn a seller's rejection of a return. | `disputes.service.js:1-14` | 🔴 |
| 12 | **No trust/risk score and no violation ledger.** Nothing records that a seller sold a counterfeit, and nothing stops them doing it again. | `grep -i "trust\|risk_score"` → no matches | 🔴 |

---

## 3. ADMIN PANEL GAPS

Your current sidebar is broadly the right shape. Below, each existing group is assessed for what is *missing inside it*, not whether it exists.

### 3.1 Dashboard
- 🟡 Overview has no **operational queue widget** (pending seller applications, documents awaiting review, products awaiting approval, open reports, unassigned tickets, failed payouts). This is the single most useful admin screen in a marketplace and it does not exist.
- 🟠 No **SLA / ageing** anywhere: nothing shows "3 KYC documents waiting > 48h".
- 🟡 Notifications page reads `admin/notifications` but admins receive no notifications for operational events (see §14).

### 3.2 Marketplace
- **Products** — 🟠 no bulk actions (bulk approve/reject/archive); 🟠 no admin-side product **image** management (no upload endpoint exists at all); 🟠 no duplicate-listing detection; 🟡 no "products by this seller" cross-link from a report.
- **Categories** — 🟠 no per-category **commission rate**, no per-category **required-attribute enforcement at submit time**, no **restricted/gated category** flag (the mechanism that makes brand authorisation enforceable).
- **Brands** — 🔴 no **brand authorisation** concept. Any seller can attach any brand to any listing. There is no `brand_authorizations` table, no document requirement, no admin grant/revoke. This is the primary counterfeit vector in Pakistani marketplaces.
- **Attributes** — 🟡 `is_required` exists on `product_attributes` but is not enforced in `products.service.js` create/update validation. Delete has no "in use" guard visible.
- **Inventory** — 🟡 no stock-movement ledger (`inventory` holds a scalar; there is no history), so "seller silently changed stock to 0 after taking orders" is invisible.
- **Product Approvals** — 🟠 no rejection **reason taxonomy** (only free-text `rejected_reason`); no **required-changes / resubmit** state distinct from rejected; no reviewer assignment; no queue ageing; no automated pre-checks (see §7).
- **Product Reports** — 🟠 `product_reports` has status `open/reviewing/upheld/dismissed` but **no action is attached to "upheld"** — resolving a report does not take the product down, warn the seller, or notify the reporter. 🟠 No evidence attachment. 🟠 No reporter feedback loop.

### 3.3 Sellers
- **All Sellers** — 🟠 seller detail has no KYC panel, no document viewer inline, no trust score, no violation history, no linked-account signals, no payout hold control, no note thread. 🟠 No **export** with permission gating.
- **Applications** — 🔴 the queue can never be populated (see §2.1). The page needs to be rebuilt against a real `seller_applications` table.
- **Verification** — 🟠 exists and works for document approve/reject, but: no "request more information" outcome, no rejection reason codes, no re-submission cycle, no expiry, no field-level verification (approving a CNIC *image* is not the same as confirming the CNIC *number* matches the name), 🔴 **no audit entry for viewing/downloading a KYC document** (`AUDIT.DOCUMENT_APPROVED/REJECTED` exist; there is no `DOCUMENT_VIEWED`). PII access must be logged.
- **Seller Performance** — 🟠 real but thin: fulfilment, cancellation, return rate, revenue, rating. Missing: refund rate, dispute rate, complaint rate, late-shipment rate, response time, policy violations, trust score, **thresholds and automated warnings** (see §9).
- **Payouts** — 🟠 no payout **hold** control, no clawback, no negative balance, no seller invoice/statement, no schedule, no reconciliation export.
- 🟠 **Missing sub-page: Seller Violations / Enforcement** — no page anywhere shows "what has this seller done wrong and what did we do about it".

### 3.4 Stores
- 🟡 Stores and Sellers are the same row (`sellers` combines account + storefront). That is a defensible simplification, but the sidebar presents them as two things while `/store-applications` routes to the same component as `/seller-applications`. Either collapse the group or make Stores genuinely about storefront presentation (branding, policies, badge, SEO) as distinct from the seller *entity*.
- 🟠 No store **verification badge** field, no store **policies** storage (return window, shipping promise, warranty), no store status independent of seller status, no store **ownership transfer** flow.

### 3.5 Customers
- 🟠 **Reviews** page is read-only (`GET /admin/reviews`). `AUDIT.REVIEW_DELETED` exists in the vocabulary but **there is no route that deletes a review**. No moderation status, no takedown, no reinstate.
- 🟠 **User Complaints** maps to the support queue; there is no complaint *classification*, no link to the seller/order/product complained about, no outcome record.
- 🟡 **Blocked Accounts** — no reason, no duration, no scheduled unblock, no appeal.
- 🟠 No customer **abuse signals**: serial returner, serial disputer, refund-fraud pattern. A marketplace needs buyer-side risk too.

### 3.6 Orders
- 🟠 Admin can read orders but cannot **act**: no admin cancel, no admin force-refund, no admin reassign, no admin override of a seller's return decision, no order note.
- 🔴 **Disputes** has no lifecycle (see §10).
- 🟠 **Returns** is read-only for admin; the seller is judge and jury on returns filed against themselves, with no escalation.

### 3.7 Mirwal AI
- 🟡 The five AI pages read real search telemetry and recommendation data, which is honest. Missing: AI moderation assist surface (see §7), query safety review (queries that seek prohibited goods), and an AI decision log.

### 3.8 Marketing & Growth
- 🔴 Coupons/Promotions/Flash Sales are CRUD over tables that **have no effect on any order**. Highest-priority correctness gap in this group.
- 🟠 No budget caps, no per-user usage limits enforced at redemption, no stacking rules, no funding attribution (seller-funded vs marketplace-funded) — which matters because a marketplace-funded coupon must not be deducted from seller payout.
- 🟡 "Financial Sections" in the sidebar is a redirect to `/finances` — dead nav item, remove it.

### 3.9 Finance
- 🟠 No commission **model**: one global `finance.commission_bps`. No per-category, per-seller, or promotional rate. No commission history.
- 🔴 No **tax handling**: no GST/sales-tax fields on orders or items, no withholding tax on payouts (Pakistan requires this), no tax invoice generation, no FBR-shaped export.
- 🟠 No ledger. Finance numbers are derived by ad-hoc aggregate queries. There is no double-entry or transaction table, so "why is this seller's balance this number" has no answer.
- 🟠 No reconciliation between gateway settlements and internal records.

### 3.10 Administration
- 🟠 Only **four roles** exist (`customer`, `seller`, `admin`, `super_admin`) and `admin` holds nearly everything. The nine roles you listed do not exist. See §12.4.
- 🟠 **29 permissions**, several dangerously coarse: `settings.manage` gates coupons, promotions, banners, **payouts**, shipping, integrations and webhooks together. A Marketing Manager who can create a banner can also approve a payout.
- 🟠 No permission separates **viewing KYC documents** from **approving a seller** — both are `seller.approve`.
- 🟠 No `*.export` permission; no `finance.*` area at all.
- 🟡 Admin Activity vs Audit Log are two routes over one dataset; fine, but Activity should be actor-centric and it is not.
- 🟠 No admin **invite / provisioning** flow, no forced-2FA enrolment gate (the setting `security.require_2fa_for_staff` exists — verify it is actually enforced at login, not just stored).

### 3.11 System
- 🟠 **Notifications** settings page exists; there is no notification *catalogue* (event → channel → audience matrix) because the event catalogue itself does not exist.
- 🟠 **Email & SMS** — templates and delivery log are real; nothing triggers them.
- 🟡 **API & Webhooks** — outbound endpoints can be registered but **no code dispatches to them**. `webhook_endpoints.last_delivery_at` can never be written. Either build the dispatcher or mark the page as configuration-only.
- 🟡 **Search Configuration** — settings exist; synonyms/boosts/blocklists do not.
- 🟠 **Security** — no IP/device fingerprint, no impossible-travel or new-device detection, no session risk scoring.
- 🟢 Backup & Restore is genuinely good (checksum, size, non-web-root, super-admin only). **Restore** is absent — it is "Backup", not "Backup & Restore".

---

## 4. SELLER PANEL GAPS

The seller panel has good coverage of *selling* and almost none of *being accountable*.

### 4.1 Account & Verification
- 🔴 No **registration**. A seller cannot sign up. Only login exists.
- 🔴 No **onboarding checklist / progress** UI ("3 of 6 steps to go live").
- 🔴 No **document upload** UI wiring (§2.4).
- 🔴 No KYC form (CNIC, DOB, address, business registration, NTN) — no fields exist to fill.
- 🔴 No **bank/payout account** entry. `payouts.destination_hint` is free text set by staff. A seller cannot tell Mirwal where to send money.
- 🟠 No visibility of verification **status, reason, or what to fix**.
- 🟡 Security settings page exists and is real (2FA, sessions, password) — good.

### 4.2 Store
- 🔴 Store profile/branding/contact/policies/hours/SEO — **eight routes, none can save.**
- 🟠 No logo/banner upload endpoint anywhere in the system.
- 🟠 No store policies (return window, dispatch time, warranty) as data.
- 🟠 No vacation / holiday mode — a seller who cannot fulfil has no way to pause their store, so orders keep landing and their cancellation rate is destroyed.

### 4.3 Products & Inventory
- 🟠 No **product image upload**. `product_images` is a table with no write path outside admin JSON. Sellers cannot list a product with photos.
- 🟠 No bulk product import/export (CSV) — essential at Pakistani seller scale.
- 🟠 No variant matrix builder beyond the default variant.
- 🟡 No visibility of *why* a listing was rejected beyond a single string, and no resubmit affordance.
- 🟠 No low-stock alerting (`low_stock_threshold` exists in `inventory`; nothing reads it).

### 4.4 Orders, Shipping, Returns
- 🟠 No **tracking number entry** when marking shipped — the status moves with no shipment behind it.
- 🟠 No packing slip / invoice generation.
- 🟠 No partial fulfilment, no partial cancellation of a line's quantity.
- 🟠 Return handling has three outcomes (`requested/approved/rejected`) and no evidence, no photos, no return shipping, no "received", no replacement.
- 🟠 No order-level buyer↔seller messaging. `support_tickets` is seller↔Mirwal only. In Pakistan, buyer-seller contact is where most disputes are actually resolved.

### 4.5 Finance
- 🟠 No statement/invoice download, no transaction ledger, no commission breakdown per order, no tax deduction display, no clawback visibility.
- 🟠 Balance is "delivered minus already-paid" with **no hold period and no reserve for open returns** (`payouts.service.js:98`). A seller can be paid for an item that is refunded the next day, with no mechanism to recover it.

### 4.6 Performance, Trust, Compliance
- 🔴 Seller cannot see their own performance metrics, warnings, violations, or standing. There is no seller-facing performance page at all.
- 🔴 No appeal mechanism for any decision taken against them.

### 4.7 Reviews & Reports
- 🟠 Seller can read reviews (`GET /seller/me/reviews`) but cannot **respond** to one or **report** an abusive one.
- 🟠 No visibility of reports filed against their listings.

---

## 5. FRONTEND (CUSTOMER) GAPS

### 5.1 Trust signals — the most consequential group
- 🔴 No **seller verification badge** on product cards, product pages, or store pages. Nothing distinguishes a KYC-verified seller from an unverified one. (There is a `/seller-verification` marketing page explaining a badge that does not exist.)
- 🟠 No seller trust indicators: account age, orders fulfilled, response rate, return rate.
- 🟠 No product authenticity signal (brand-authorised, genuine-guarantee).
- 🟠 No visible return/refund policy per seller on the product page.

### 5.2 Reporting
- 🔴 **Report a problem** page (`/report`) is non-functional by its own admission ("no report was sent because the reporting service is not configured"). Product, seller, order, payment and fraud reporting all dead-end here.
- 🔴 **The product report endpoint exists and is unreachable.** `POST /products/:slug/report` is live, well-designed and gets anonymous reports right — and `apps/storefront/src/api.js` has no method for it and no page calls it. This is a one-day fix with outsized safety value.
- 🟠 No review reporting, no seller reporting, no store reporting.

### 5.3 Orders, returns, disputes
- 🟠 **Cancel and return are only reachable from `/order-success/:orderId`.** The `/orders` account page (`OrdersContent`) lists orders with no per-item cancel or return action. A customer who leaves the confirmation page cannot start a return through the UI.
- 🟠 No order tracking detail (no shipment data exists to show).
- 🟠 No return status timeline, no return shipping instructions, no refund status visibility (`GET /payments/refunds` exists; the storefront client has no method for it).
- 🔴 No dispute creation. If a seller rejects a return, the customer's journey ends.

### 5.4 Reviews
- 🟢 Verified-purchase review writing works and is correctly gated. Good.
- 🟠 Missing: review photos, helpfulness voting, sorting/filtering, seller responses displayed, report-this-review, edit window, review history in account.

### 5.5 Commerce
- 🔴 No coupon/promo code field at checkout.
- 🟠 Shipping shown as "FREE" with an honest note; needs wiring to the live quote endpoint.
- 🟡 Cart is client-side only — not persisted server-side, so it does not survive device change and cannot be recovered or analysed.
- 🟡 No saved payment methods (the `/payment-methods` account route exists).
- 🟡 No guest checkout.

### 5.6 Account & security
- 🟠 No email/phone verification prompts or flows.
- 🟡 `/recently-viewed`, `/saved-searches`, `/my-chats` are routed account pages with no backing data model.
- 🟢 Sessions, 2FA, password change are real.

### 5.7 UX states
- 🟢 Loading / error / empty states are consistently present (`LoadingState`, `ErrorState`, `EmptyState`) and the empty states are honest rather than fake. This is better than most codebases at this stage.
- 🟠 Missing **confirmation states** for destructive/irreversible actions (cancel item, delete address, remove document).
- 🟡 Missing optimistic-update rollback on wishlist/cart.
- 🟡 Mobile: `MobileBottomNav` exists; wide admin/seller tables have no documented horizontal-scroll containment — worth a pass.

---

## 6. SELLER VERIFICATION / KYC SYSTEM

### 6.1 Current state
`sellers.status` is `pending | approved | suspended | rejected | closed`. `seller_documents` supports six document types with `pending/approved/rejected` and a reviewer. Admin can approve/reject/suspend/reinstate a seller. **That is the whole system.** There is no application, no identity data, no bank verification, no risk gate, no expiry, no re-verification.

### 6.2 Recommended lifecycle

```
Registration (user account, email + phone)
  → Email verified  → Phone verified                    [automated]
  → Application submitted (seller_type chosen)          [seller]
  → Identity / KYC review (CNIC + selfie/liveness)      [agent]
  → Business verification (registered businesses only)  [agent]
  → Bank / payout verification (micro-deposit or title) [automated + agent]
  → Store review (name, logo, policies, categories)     [agent]
  → Decision: Approved | Rejected | More Info Required
  → Active
  → Restricted (can sell, cannot payout / cannot add products)
  → Suspended (listings hidden, orders must still be fulfilled)
  → Banned (terminal)
```

Statuses to add to `sellers.status`: `draft`, `submitted`, `in_review`, `more_info_required`, `restricted`, `banned`. Plus a separate `verification_level` (`none | basic | identity_verified | business_verified`) — because *status* (can they trade) and *level* (how much do we know) are different questions and conflating them is why marketplaces end up unable to answer either.

### 6.3 Required information — by seller type

**INDIVIDUAL SELLER**

| Field | Requirement | Note |
|---|---|---|
| Full name (as on CNIC) | **Required** | Must match CNIC document |
| CNIC number (13 digits) | **Required** | Validate format + checksum; unique across sellers |
| Date of birth | **Required** | Must be ≥ 18 |
| Mobile (E.164, verified by OTP) | **Required** | |
| Email (verified) | **Required** | |
| Residential/business address + city + province | **Required** | |
| CNIC front + back images | **Required** | |
| Selfie holding CNIC | **Conditional** — required above a risk threshold or for high-value categories | Do not demand from every hobby seller |
| Bank account title + IBAN, **or** JazzCash/EasyPaisa MSISDN | **Required before first payout**, not before listing | Deferring this is the single biggest onboarding-conversion win |
| Bank statement / account-title letter | **Conditional** — when account title ≠ CNIC name | |
| NTN | **Optional** for individuals | |
| Category authorisation docs | **Conditional** — gated categories only | |

**BUSINESS SELLER**

| Field | Requirement | Note |
|---|---|---|
| Registered business name | **Required** | |
| Business type (sole proprietor / AOP / Pvt Ltd) | **Required** | Drives which documents apply |
| Owner/authorised-signatory full name + CNIC | **Required** | |
| NTN | **Required** | Validate format |
| Sales-tax registration (STRN) | **Conditional** — required if the seller charges GST | |
| Certificate of incorporation / SECP registration | **Required for Pvt Ltd**, optional for sole proprietor | |
| Business registration / trade licence | **Conditional** by type | |
| Registered business address + city + province | **Required** | |
| Business bank account (title must match business name) + IBAN | **Required before first payout** | |
| Bank account-title letter | **Required** | |
| Authorisation letter | **Conditional** — when the applicant is not the owner | |
| Brand authorisation letter / distributor agreement | **Conditional** — per gated brand, not per account | |

**Risk-triggered (any type)** — request only when triggered, never by default: proof of address (utility bill), proof of inventory sourcing (invoices), video verification. Triggers: counterfeit report upheld, chargeback rate above threshold, payout destination changed, multiple accounts detected, high GMV velocity from a new account, category upgrade to gated.

### 6.4 How admins should verify

Per document: side-by-side viewer (document + submitted field values), field-match checkboxes (name matches / number matches / not expired / legible / not a screenshot of a screenshot), decision (`approve` / `reject with reason code` / `request better copy`), and a mandatory note on rejection. Decisions and **views** both write to `audit_logs`.

### 6.5 Required edge-case handling

| Situation | Required behaviour |
|---|---|
| Document unclear/illegible | `more_info_required` with a specific reason code; seller notified; original retained; resubmission creates a new document row, never overwrites |
| Information doesn't match | Do not auto-reject. Flag as `mismatch`, escalate to a senior reviewer, record which field mismatched |
| Fake document suspected | Immediate `restricted` (listings frozen, payouts held), case opened, escalation to Risk role, seller notified with an appeal route. Never silent |
| Seller refuses to provide info | Time-boxed: 14 days in `more_info_required` → `restricted`; 30 days → application expires. Existing orders must still be fulfillable |
| Verification expires (CNIC/registration expiry date) | 30/7-day reminders, then `restricted` — never instant suspension of a trading store |
| **Seller changes key info after verification** (bank account, CNIC, legal name, phone, email) | **Payout hold + re-verification of the changed element.** Bank-account change is the #1 seller-account-takeover cash-out path. Require 2FA + a cooling-off period (48–72h) + notification to the *old* contact details |

**Missing DB support:** `seller_applications`, `seller_kyc_profiles` (or KYC columns on `sellers`), `seller_bank_accounts`, `document_review_events`, `verification_expiries`, `seller_type` enum, unique index on CNIC/NTN to detect duplicate accounts.

---

## 7. PRODUCT MODERATION SYSTEM

### 7.1 Current state
Genuinely good bones: `draft → pending_review → active`, seller cannot self-publish, editing a live listing forces re-review, admin `catalog.product.approve` permission, `product_reports` from shoppers including anonymous ones. **All checks are human.** There is zero automated validation, and "upheld report" triggers no action.

### 7.2 Recommended pipeline

```
Seller submits
  → [AUTOMATED, blocking]   schema/business validation
  → [AUTOMATED, scoring]    risk checks → risk_score + flags
  → route: auto-approve (low risk, trusted seller)
         | manual queue    (any flag, or seller below trust threshold)
         | auto-reject     (hard rules only — prohibited keyword, banned seller)
  → Live
  → Customer reports / anomaly detection
  → Re-review
  → Outcome: no action | edit required | delisted | seller warned | seller penalised
```

### 7.3 What to automate vs. escalate

**Automate (blocking, deterministic — safe to reject on):**
- Required attributes present for the category; images present, min resolution, no duplicate hashes
- Price sanity: `compare_at_price > price` (already enforced by CHECK — good), price within N× category median, price ≠ 0
- Prohibited keyword/category list (weapons, medicines, wildlife, currency, adult, counterfeits by name)
- Duplicate detection: identical title+brand+image hash within the same seller, and across sellers
- Brand attached but seller lacks authorisation for a gated brand → **hard block**
- Category/brand mismatch heuristics

**Automate (scoring, never auto-reject — flags for a human):**
- Title quality (ALL CAPS, "100% original", "copy", "master copy", "replica", "first copy" — the Pakistani counterfeit vocabulary specifically)
- Image reused from another seller's listing (perceptual hash)
- Stock/price volatility, suspicious discount depth
- Seller's own risk score

**Always human:**
- Any counterfeit or authenticity call
- Any prohibited-goods judgement call
- Any seller penalty
- Any delisting of a seller's top-revenue product

**AI's role:** classify, flag, draft the reviewer's summary, suggest a reason code. AI must never be the final actor on a takedown or a penalty. Every AI-assisted decision must record the model, confidence and the human who confirmed it.

### 7.4 Missing pieces
- 🔴 `brand_authorizations` table + enforcement (counterfeit vector)
- 🔴 Report → action linkage (upholding a report must be able to delist and warn)
- 🟠 `product_moderation_events` (who did what, when, why — `products` holds only the current status)
- 🟠 Rejection reason codes + a seller-visible "what to fix" list
- 🟠 `prohibited_terms` / policy rules table, admin-editable
- 🟠 Image perceptual hashing for duplicate/stolen-image detection
- 🟠 Delisting as a distinct state from `rejected` and `archived` (a policy takedown is not a draft)
- 🟠 Re-review queue for previously-approved products with new reports
- 🟡 Reporter feedback ("we reviewed your report and acted")

---

## 8. REVIEW & RATING SAFETY

### 8.1 Current state
Verified purchase is enforced at the database level (`order_item_id` NOT NULL + UNIQUE). This is the hardest part and it is done correctly. **Everything else is missing.**

### 8.2 Gaps

| Gap | Sev |
|---|---|
| No moderation status on `product_reviews` (`published/pending/hidden/removed`) — a review cannot be taken down | 🔴 |
| No admin removal route (`AUDIT.REVIEW_DELETED` exists as a constant with no endpoint behind it) | 🔴 |
| No review reporting (customer or seller) — `review_reports` table absent | 🟠 |
| No seller response to a review | 🟠 |
| No appeal for a removed review | 🟡 |
| No review edit window / edit history | 🟡 |
| No review images | 🟡 |
| No helpfulness voting; no sort/filter on the product page | 🟡 |
| Rating recomputation: verify it excludes hidden/removed reviews once those exist | 🟠 |
| No incentivised-review detection (review mentions a discount/gift; seller messaged buyer before review) | 🟠 |
| No review-bombing detection (velocity spike, rating distribution anomaly, new-account clustering) | 🟠 |
| No reviewer-side risk (accounts that only ever 5-star one seller, or only ever 1-star a competitor) | 🟠 |
| No linkage between reviewer and seller (same IP/device/address = self-review ring) | 🟠 |
| No audit trail on review moderation | 🟠 |

### 8.3 Recommended
Add `product_reviews.status` + `moderated_by` + `moderated_at` + `moderation_reason`; `review_reports`; `review_responses` (seller, one per review, itself moderatable); `review_moderation_events`. Add a **rating freeze** for a product under active counterfeit investigation. Recompute `rating_average` from published reviews only, in a single well-tested function.

---

## 9. TRUST & RISK SYSTEM

Nothing exists today. Recommended design:

### 9.1 Two scores, not one
- **Trust score (0–100, seller-visible)** — earned standing. Drives badges, search boost, payout speed, auto-approval eligibility.
- **Risk score (0–100, internal only)** — probability of harm. Drives payout holds, manual review, investigation priority. **Never show this to the seller** and never let it be reverse-engineered from behaviour.

### 9.2 Inputs

| Signal | Score | Weight | Notes |
|---|---|---|---|
| Verification level | Trust | High | Unverified caps trust at a low ceiling |
| Account age | Trust | Medium | Time-decayed |
| Orders fulfilled (volume) | Trust | Medium | Log-scaled; 3 perfect orders ≠ 300 |
| Customer rating average + count | Trust | High | Confidence-weighted (already the pattern used in AI ranking) |
| On-time dispatch / delivery rate | Trust | High | Needs shipment data (missing) |
| Cancellation rate (seller-initiated) | Both | High | Seller cancels ≠ buyer cancels — must be separated; currently is not |
| Return rate | Both | Medium | Normalise by category |
| Refund rate | Both | Medium | |
| Dispute rate + loss rate | Risk | High | Needs disputes (missing) |
| Complaints per 100 orders | Risk | High | |
| Product reports upheld | Risk | **Very high** | Counterfeit-upheld should be near-terminal |
| Policy violations (count, recency, severity) | Risk | Very high | Needs a violations ledger (missing) |
| Review-manipulation signals | Risk | High | |
| Response time to buyers/support | Trust | Medium | |
| Payout/chargeback history | Risk | High | |
| Suspicious behaviour (multi-account, device/IP overlap, sudden GMV spike, bank-account change) | Risk | Very high | |

### 9.3 What admin should see
A single seller risk panel: both scores, the trend, the top three contributing factors *with the underlying counts*, the violation ledger, current enforcement state, and every threshold this seller has crossed. A score with no explanation is unusable in an appeal — and appeals will happen.

### 9.4 Automation policy
Scores may **automatically**: hold a payout, route to manual review, remove auto-approval, throttle new listings, hide a badge.
Scores may **never automatically**: suspend, ban, delist an entire catalogue, or seize funds. Those require a human and an audit entry.

**Missing DB support:** `seller_scores` (current + history), `seller_violations`, `seller_enforcement_actions`, `risk_signals`, `seller_account_links`.

---

## 10. REPORTS / DISPUTES / ENFORCEMENT

### 10.1 Current state
- Product reports: real table, real endpoint, **unreachable from the UI**, and upholding one does nothing.
- Seller / review / store / order / fraud reports: do not exist.
- Disputes: read-only view of return requests. No lifecycle, no actions, no evidence, no communication.

### 10.2 Recommended unified case model
One `cases` table rather than six report tables — reports, complaints and disputes are the same object with different subjects:

```
case_type: product | seller | store | review | order | payment | fraud | counterfeit | policy
subject_type + subject_id
reporter_id (nullable — anonymous reports still matter)
against_seller_id (nullable, denormalised for the enforcement view)
status: reported → under_review → more_info_required → action_taken → resolved | rejected | appealed → closed
priority, assigned_to, sla_due_at
resolution_code, resolution_note, resolved_by, resolved_at
```

Plus: `case_evidence` (files, reusing the existing hardened storage layer), `case_messages` (with `is_internal`, exactly as `support_messages` already does), `case_actions` (what enforcement this case produced), and audit entries for every transition.

### 10.3 Required actions attachable to a case
Warn seller · Require product edit · Delist product · Delist category · Restrict listing creation · Hold payout · Suspend store · Ban seller · Refund buyer · Remove review · Block buyer · No action (with reason).

Each action needs: reason code, actor, timestamp, expiry (a 7-day restriction must lift itself), reversal path, and a notification to the affected party. **Every enforcement action must be appealable**, and the appeal must be reviewable by someone other than the original decider.

### 10.4 Missing
🔴 case model · 🔴 evidence · 🔴 dispute lifecycle & admin override of seller return decisions · 🔴 enforcement actions · 🟠 appeals · 🟠 SLA/ageing · 🟠 reporter feedback · 🟠 all notifications on all of the above.

---

## 11. FINANCE & PAYOUT GAPS

### 11.1 What is solid
Double-payment is impossible (`uq_payout_items_item`). Commission is snapshotted. Refund double-issue is impossible. COD refunds have a truthful manual state.

### 11.2 Gaps

| Gap | Sev |
|---|---|
| **No hold period.** Balance = delivered items not yet paid out. An item delivered today is withdrawable today, before the return window closes | 🔴 |
| **No reserve against open returns/disputes** — money is offered to the seller while a refund is pending | 🔴 |
| **No clawback / negative balance.** If a refund lands after payout, nothing recovers it | 🔴 |
| **No tax.** No GST on orders, no withholding tax on payouts, no tax invoices | 🔴 |
| **No coupon/promotion funding attribution** — a marketplace-funded discount would silently reduce seller earnings (once coupons work at all) | 🟠 |
| No chargeback handling — no table, no status, no seller liability | 🟠 |
| No adjustments/manual credits/debits | 🟠 |
| No seller statement/invoice generation | 🟠 |
| No payout schedule (weekly/biweekly); everything is seller-requested | 🟠 |
| Minimum threshold hard-coded to Rs. 1,000 in code, not a setting | 🟡 |
| No risk-based payout hold (needs risk score) | 🟠 |
| No transaction ledger — balances are derived, not recorded; admin and seller views compute independently and can drift | 🟠 |
| Payout destination is free text, not a verified bank account entity | 🔴 |
| Shipping fee is 0 in every order, so GMV, commission and seller earnings are all computed on an incomplete total | 🔴 |

### 11.3 Recommendation
Introduce a `seller_ledger_entries` table (order earning, commission, refund reversal, adjustment, tax withheld, payout debit) as the **single source of truth** for balance, with `available_at` implementing the hold. Every current derived query becomes a read of this ledger. This one change fixes hold, reserve, clawback, negative balance, statements and admin/seller consistency simultaneously.

---

## 12. SECURITY GAPS

### 12.1 Strong today (do not touch)
scrypt + rotation + reuse detection + lockout + TOTP + hashed backup codes; permission checks on every admin route; webhook signature verification with raw body; upload magic-byte validation + traversal guard + non-web-root storage + authenticated-only reads; secrets in env, never in `platform_settings`; `helmet`, CORS allowlist, `trust proxy 1`; JSON validity CHECKs; parameterised queries throughout.

### 12.2 Gaps

| Gap | Sev |
|---|---|
| **No audit entry when staff view or download a KYC document.** PII access is unlogged | 🔴 |
| **Seller suspension not enforced on the storefront** (also a trust gap) | 🔴 |
| Rate limiting is one global bucket + a credential limiter. No specific limits on document upload, product report, review creation, order creation, payout request, password reset | 🟠 |
| No account-takeover detection: no new-device/new-IP alerting, no impossible travel, no notification on password change, email change, 2FA change or bank-account change | 🔴 |
| No multi-account detection (device fingerprint, IP, CNIC/NTN/phone/bank reuse). CNIC has no unique index because it has no column | 🟠 |
| 2FA is optional for staff. `security.require_2fa_for_staff` exists as a setting — **verify it is enforced at login**, not merely stored | 🔴 |
| No step-up authentication for sensitive actions (payout approval, bank change, role grant, KYC view) | 🟠 |
| No IP allowlist for admin | 🟡 |
| Coarse permissions enable privilege creep (`settings.manage` = marketing + payouts + integrations) | 🟠 |
| No PII redaction in `system_logs` / `audit_logs` metadata | 🟠 |
| No data-retention policy for KYC documents (they are kept forever) | 🟠 |
| No suspicious-order detection (velocity, address/card mismatch, COD abuse — the dominant Pakistani fraud vector) | 🟠 |
| No CSRF consideration documented for the cookie-based refresh path (verify `SameSite` on the refresh cookie) | 🟠 |
| No `Content-Security-Policy` on the three frontends | 🟡 |
| Document downloads stream to any staff member holding `seller.approve` — no per-request justification, no time-limited link | 🟡 |

### 12.3 Admin roles — recommended
Nine roles, built from a much finer permission set. Verbs per area: `view · create · edit · approve · reject · suspend · delete · export · refund · payout · view_pii`.

| Role | Gets | Explicitly denied |
|---|---|---|
| **Super Admin** | Everything incl. `role.manage`, backups, security policy | — |
| **Marketplace Manager** | Catalog, sellers (view/suspend), orders, reports, stores | KYC PII, finance, payouts, roles |
| **Seller Verification Agent** | Applications, KYC documents (`seller.kyc.view`), approve/reject/request-info | Finance, payouts, catalog write, customer data |
| **Product Moderator** | Product approvals, product reports, brand authorisations, enforcement on listings | Sellers, finance, KYC, customers |
| **Customer Support** | Orders (view), tickets, returns (view), customers (limited), refund *request* | Refund approval, payouts, KYC, seller suspension |
| **Finance Manager** | Payouts, refunds, commission, tax, exports, reconciliation | KYC documents, catalog, roles, security |
| **Marketing Manager** | Coupons, promotions, banners, campaigns, marketing analytics | Payouts, settings, sellers, customers |
| **AI Manager** | AI configuration, search configuration, query review, recommendation tuning | Finance, KYC, enforcement |
| **Security / Risk Manager** | Risk scores, cases, enforcement, sessions, audit logs, security policy, fraud signals | Catalog write, marketing |

Principle to encode: **KYC PII, financial actions and security controls are three separate keys, and no operational role holds more than one.**

---

## 13. DATABASE / BACKEND GAPS

### 13.1 Missing tables

🔴 `seller_applications` · `seller_kyc_profiles` (or KYC columns) · `seller_bank_accounts` · `brand_authorizations` · `shipments` · `seller_ledger_entries` · `cases` (+ `case_evidence`, `case_messages`, `case_actions`) · `seller_violations` · `seller_enforcement_actions`

🟠 `seller_scores` (+ history) · `review_reports` · `review_responses` · `product_moderation_events` · `document_review_events` · `store_policies` · `inventory_movements` · `order_events` (status history) · `tax_rates` · `commission_rules` · `prohibited_terms` · `carriers` · `webhook_deliveries` · `notification_preferences` · `seller_account_links`

🟡 `product_questions` (Q&A) · `saved_searches` · `recently_viewed` · `carts` (server-side) · `payment_methods` · `product_image_hashes` · `case_appeals`

### 13.2 Missing columns on existing tables

| Table | Missing |
|---|---|
| `sellers` | `seller_type`, `verification_level`, `verified_at`, `trust_score`, `risk_score`, `cnic`, `ntn`, `business_reg_no`, `address_line1/2`, `province`, `postal_code`, `commission_bps_override`, `payout_hold`, `vacation_mode`, `restricted_until`, `banned_at`, `banned_reason`, `applied_at`, `store_verified_badge` |
| `orders` | `discount_total`, `tax_total`, `coupon_id`, `payment_status` values `partially_refunded`, status values `partially_cancelled`/`returned`/`failed_delivery` |
| `order_items` | `discount_amount`, `tax_amount`, `commission_amount`, `cancelled_by` (buyer vs seller — currently indistinguishable, which corrupts every cancellation-rate metric), `cancelled_reason`, `shipped_at`, `delivered_at` |
| `return_requests` | statuses `more_info_required`/`in_transit`/`received`/`refunded`/`cancelled`/`escalated`, `evidence_count`, `return_type` (refund vs replacement), `return_tracking_number`, `escalated_at`, `admin_override_by` |
| `product_reviews` | `status`, `moderated_by`, `moderated_at`, `moderation_reason`, `edited_at`, `helpful_count` |
| `products` | `delisted_at`, `delisted_reason`, `moderation_flags`, `risk_score`, `authorized_brand` |
| `product_reports` | `evidence_path`, `action_taken`, `reporter_notified_at` |
| `seller_documents` | `document_number`, `issued_at`, `expires_at`, `verified_fields` (JSON), `rejection_code`, `supersedes_id` |
| `payouts` | `hold_reason`, `held_by`, `held_at`, `tax_withheld`, `adjustments` |
| `users` | `last_password_change_at` (exists as `password_set_at` — good), `phone_verified_at` is present but never written, device/IP risk columns |

### 13.3 Missing constraints & indexes
- 🔴 Unique index on `sellers.cnic` and `sellers.ntn` once they exist (duplicate-account detection)
- 🟠 `uq_return_requests_order_item` currently allows **one return attempt ever** per item, including after rejection. With an escalation path this becomes wrong — it must move to "one *open* request" once appeals exist
- 🟠 `uq_product_reports_once (product_id, reporter_id, status)` — with a nullable `reporter_id`, MySQL treats NULLs as distinct, so anonymous reports are unlimited. Add rate limiting/IP hashing
- 🟠 No index for the "products by seller status" storefront join that §2.2 requires
- 🟡 `payment_webhook_events.payload` LONGTEXT with no retention policy

### 13.4 Missing endpoints (high value first)

🔴 `POST /seller/apply` · `PATCH /seller/me/store` · `POST /seller/me/store/logo|banner` · `POST /seller/me/products/:id/images` · `POST /seller/me/kyc` · `POST /seller/me/bank-accounts` · `POST /admin/sellers/:id/restrict|ban|hold-payout` · `POST /admin/returns/:id/override` · `PATCH /admin/reviews/:id` (moderate) · `DELETE /admin/reviews/:id` · `POST /cases` (+ full case CRUD) · `POST /reviews/:id/report` · `POST /sellers/:slug/report` · `POST /orders/:id/dispute` · coupon apply at checkout

🟠 `POST /auth/verify-email` + `/resend` · `POST /auth/verify-phone` (OTP) · `POST /seller/me/orders/:id/ship` (with tracking) · `GET /orders/:id/tracking` · `GET /payments/refunds` client wiring · `GET /seller/me/performance` · `GET /seller/me/violations` · `POST /appeals` · `POST /admin/products/bulk-*` · `GET /admin/queues/summary`

### 13.5 Missing background jobs / events
There is **no job runner at all**. Needed: verification-expiry reminders, payout hold release, return-window closure, review-eligibility reminders, risk-score recomputation, outbound webhook dispatch + retry, notification digest, abandoned-cart, KYC retention purge, search-index refresh, `payment_attempts` reconciliation sweep for stuck `pending` payments. 🔴 for the reconciliation sweep and payout hold release; 🟠 for the rest.

### 13.6 Outbound webhooks
`webhook_endpoints` is registerable and **nothing dispatches**. Either build the dispatcher (+ `webhook_deliveries`, retry with backoff, signature) or clearly label the page as future configuration. 🟠

---

## 14. NOTIFICATION GAPS

Today: 8 in-app emit sites (order placed / status changed / item cancelled / new order / payment received / return requested / return resolved / refund issued) **and** 8 real `messaging.send()` email sites (password reset/changed, product approved/rejected, seller approved/rejected, document reviewed, order refunded). Missing: **order confirmation and shipped email** (templates exist, no caller), all verification mail, all payout mail, and **the entire SMS channel**. In Pakistan, SMS is the channel that actually reaches people — this is not optional.

### 14.1 Missing events

**Customer** — email verification 🔴 · phone OTP 🔴 · welcome 🟡 · order confirmation (email/SMS) 🔴 · payment failed 🔴 · shipped with tracking 🔴 · out for delivery 🟠 · delivered 🟠 · delivery failed 🟠 · return approved/rejected 🔴 · return received 🟠 · refund issued/settled 🔴 · dispute updates 🔴 · review reminder 🟡 · review removed 🟠 · report acknowledged + outcome 🟠 · **password changed / email changed / 2FA changed / new device login** 🔴 · account suspended 🔴 · price drop / back in stock 🟢

**Seller** — application received 🔴 · document approved/rejected/more-info 🔴 · seller approved/rejected 🔴 · store suspended/restricted/reinstated 🔴 · product approved/rejected/delisted 🔴 · new order (email/SMS) 🔴 · order cancelled by buyer 🟠 · return filed 🔴 · dispute escalated 🔴 · payout approved/paid/failed/held 🔴 · low stock 🟠 · new review 🟡 · performance threshold breached 🔴 · violation recorded / warning issued 🔴 · **bank account changed** 🔴 · appeal outcome 🟠

**Admin** — new seller application 🟠 · KYC queue ageing past SLA 🟠 · counterfeit report filed 🔴 · high-risk seller threshold crossed 🟠 · payout above threshold requested 🟠 · payment webhook failures 🟠 · error-rate spike 🟠 · backup failed 🟠 · unusual admin activity 🟠

### 14.2 Infrastructure gaps
🔴 Nothing calls the send path · 🔴 no event bus (notifications are inline `await`s inside service functions; a failed send can affect the transaction) · 🟠 no user notification preferences · 🟠 no digest/batching · 🟠 no retry on failed delivery · 🟠 no unsubscribe · 🟡 no template versioning · 🟠 no per-channel routing rules (which events go to SMS given SMS costs money).

---

## 15. UX / UI GAPS

- 🟢 **Keep:** honest empty states, consistent loading/error components, code-splitting, mobile bottom nav, per-route SEO metadata.
- 🟠 **Confirmation dialogs** are missing on irreversible actions across all three apps (cancel item, delete address, delete document, delete product, revoke session, reject seller). Every destructive action needs a typed or explicit confirm with a stated consequence.
- 🟠 **Seller onboarding UX** does not exist: no progress indicator, no "what's blocking me", no per-step help. This is where marketplace seller acquisition is won or lost.
- 🟠 **Status legibility**: statuses render as raw enum values in several places. Every status needs a label, a colour, a definition and a "what happens next".
- 🟠 **Rejection feedback**: a rejected product or document shows a string. Sellers need a structured reason + the exact fix + a resubmit button.
- 🟠 **Admin queue ergonomics**: no bulk selection, no keyboard-driven review, no saved filters, no assignment, no ageing badges. A verification agent reviewing 200 documents/day cannot use the current UI.
- 🟡 **Wide tables** in admin/seller need explicit `overflow-x` containment; verify no page body scrolls horizontally on mobile.
- 🟡 **Optimistic updates** (wishlist, cart) have no rollback on failure.
- 🟡 **Accessibility**: verify focus management on modals, `aria-live` on async status messages, and 44px touch targets in the seller panel.
- 🟡 Dead nav items to remove: admin "Financial Sections" (redirect only), duplicate "AI Analytics" under Finance, `/store-applications` pointing at the seller applications component.
- 🟢 `apps/storefront/src/data/mockData.js` and `sellerMockData.js` (695 lines) appear unreferenced — confirm and delete.

---

## 16. EDGE CASES WE MUST HANDLE

Grouped by where they will actually bite.

**Seller lifecycle**
1. Seller suspended with open orders → must still be able to fulfil; listings hidden; payouts held; buyers notified. *(Currently: listings stay live — the opposite of correct.)*
2. Seller deletes their account with pending payouts / open returns → block or escrow.
3. Seller changes bank account mid-payout → hold, re-verify, notify old contact.
4. Two accounts, one CNIC → detect and merge/ban.
5. Application abandoned halfway → expiry + reminder + resumable draft.
6. Verified seller's CNIC/registration expires → graduated restriction, not instant suspension.
7. Seller renames store to impersonate a brand → name-change moderation.

**Catalogue**
8. Approved product edited to something entirely different → already handled (forces re-review). ✅
9. Product delisted while in someone's cart / already ordered → order must complete; cart must warn.
10. Category deleted with live products → `RESTRICT` is set. ✅
11. Brand deleted → `SET NULL` leaves products brandless silently; needs an admin warning.
12. Two sellers, identical SKU → handled by `uq_product_variants_seller_sku`. ✅

**Orders & money**
13. Multi-seller order where one seller cancels → partial cancellation, partial refund, recomputed totals. *(No partial states exist.)*
14. COD order refused at the door → `failed_delivery`, restock, no refund needed, seller not penalised for a buyer refusal.
15. Buyer cancels after dispatch → refuse or convert to a return.
16. Payment succeeds after the order was auto-cancelled for timeout → the reconciliation sweep must catch and refund.
17. Duplicate webhook / out-of-order webhook → handled. ✅
18. Refund larger than remaining paid amount → needs a guard.
19. Item delivered → paid out → returned and refunded → seller balance must go negative. *(Impossible today.)*
20. Buyer requests a return on the last day of the window while the payout is already requested.
21. Inventory oversell under concurrency → `reserved` and the CHECK exist; verify the reservation is inside the order transaction with row locking.
22. Price changes between cart and checkout → order re-reads from DB. ✅
23. Coupon used concurrently past its usage limit → needs atomic redemption once coupons work.
24. COD chargeback equivalent: buyer claims non-delivery after courier marks delivered → needs dispute + proof-of-delivery.

**Trust & safety**
25. Counterfeit report on a product with 500 delivered orders → mass refund/notification path.
26. Review left, then the order is refunded → decide (keep, flag, or remove) and implement it.
27. Seller and reviewer share a device/IP/address → self-review ring detection.
28. Report filed by a competitor in bad faith → reporter reputation, so abuse of reporting is itself detectable.
29. Seller appeals a ban → different reviewer, evidence, deadline, outcome record.
30. KYC document contains a third party's PII → retention + deletion path.

**Accounts & security**
31. Customer account takeover → order shipped to a new address; needs new-address + new-device alerting.
32. Admin account compromised → forced 2FA, session revocation, audit review, IP allowlist.
33. Staff member leaves → deactivation must revoke sessions and reassign their queue.
34. Same email used for customer and seller → `users` supports multi-role. ✅

---

## 17. RECOMMENDED ADMIN SIDEBAR STRUCTURE

Changes from your current structure are marked **NEW** / **MOVED** / **REMOVE**. Everything unmarked exists and stays.

```
1. Dashboard
   Overview
   Operations Queue                          ← NEW 🔴 (all pending work, one screen)
   Analytics
   Notifications

2. Catalogue                                  (renamed from "Marketplace")
   Products
   Product Approvals
   Product Reports
   Categories
   Brands
   Brand Authorisations                       ← NEW 🔴
   Attributes
   Inventory
   Moderation Rules                           ← NEW 🟠 (prohibited terms, auto-check config)

3. Sellers
   All Sellers
   Applications                               (rebuild against real applications 🔴)
   Verification / KYC                         (permission-separated 🔴)
   Bank & Payout Verification                 ← NEW 🔴
   Seller Performance
   Trust & Risk                               ← NEW 🟠
   Violations & Enforcement                   ← NEW 🔴
   Appeals                                    ← NEW 🟠
   Payouts                                    → MOVED to Finance

4. Stores
   All Stores
   Store Policies                             ← NEW 🟠
   Store Reports                              ← NEW 🟠
   REMOVE "Store Applications" (duplicate of Seller Applications)

5. Customers
   All Customers
   Reviews & Moderation                       (add moderation actions 🔴)
   Complaints
   Buyer Risk                                 ← NEW 🟠
   Blocked Accounts

6. Orders & Fulfilment
   All Orders
   Shipments & Tracking                       ← NEW 🔴
   Returns
   Refunds
   Disputes                                   (build the real lifecycle 🔴)
   Chargebacks                                ← NEW 🟠

7. Trust & Safety                              ← NEW GROUP 🔴
   Case Queue
   Counterfeit Reports
   Fraud Signals
   Enforcement Log
   Policy Library

8. Mirwal AI
   AI Overview
   Shopping Queries
   Recommendations
   Comparisons
   AI Moderation Assist                       ← NEW 🟠
   AI Analytics

9. Marketing & Growth
   Promotions · Campaigns · Coupons · Flash Sales · Banners
   REMOVE "Financial Sections"

10. Finance
   Finance Overview
   Payouts                                    ← MOVED from Sellers
   Payout Holds                               ← NEW 🔴
   Seller Ledger & Statements                 ← NEW 🟠
   Commission Rules                           ← NEW 🟠
   Tax & Invoices                             ← NEW 🔴
   Reconciliation                             ← NEW 🟠
   Business / Marketplace / Seller / Customer Analytics
   REMOVE duplicate "AI Analytics"

11. Administration
   Admin Users · Roles & Permissions · Teams · Access Control
   Login Sessions · Admin Activity · Audit Log
   PII Access Log                             ← NEW 🔴

12. System
   (all current items retained)
   + Notification Catalogue                   ← NEW 🟠
   + Background Jobs                          ← NEW 🟠
   + Restore                                  ← NEW 🟡 (Backup exists; Restore does not)
```

---

## 18. RECOMMENDED SELLER SIDEBAR STRUCTURE

```
Dashboard
  Overview
  Onboarding Checklist                        ← NEW 🔴 (shown until fully verified)

Account & Verification                         ← NEW GROUP 🔴
  Profile
  Identity / KYC
  Business Details
  Bank & Payout Account
  Documents
  Verification Status

Store
  Store Profile          (make it savable 🔴)
  Branding               (logo/banner upload 🔴)
  Policies               ← NEW 🟠
  Shipping Settings
  Vacation Mode          ← NEW 🟠
  Store Preview

Catalogue
  My Products
  Add Product            (with image upload 🔴)
  Bulk Import / Export   ← NEW 🟠
  Rejected & Action Required  ← NEW 🟠
  Inventory              ← NEW 🟠 (currently only inline per product)
  Categories · Brands (reference)
  Reviews                (add seller response 🟠)

Orders
  All Orders
  To Ship                ← NEW 🟠
  Shipments & Tracking   ← NEW 🔴
  Cancellations
  Returns & Refunds
  Disputes               ← NEW 🔴
  Customers

Performance & Compliance                       ← NEW GROUP 🔴
  Performance Metrics
  Trust Score & Standing
  Violations & Warnings
  Appeals
  Policy Centre

Finance
  Overview
  Ledger & Statements    ← NEW 🟠
  Withdrawals
  Invoices & Tax         ← NEW 🟠
  Payout Settings

Marketing
  Promotions · Coupons · Campaigns · Performance

Support
  Help Center · Seller Support · Notifications

Settings
  Account Security (2FA, sessions) · Notification Preferences ← NEW 🟡
```

---

## 19. RECOMMENDED FRONTEND FEATURES

**Trust (highest ROI)**
🔴 Seller verification badge on card / PDP / store page · 🔴 wire `POST /products/:slug/report` to a "Report this listing" control (endpoint already exists) · 🔴 make `/report` functional against the case model · 🟠 seller trust panel on PDP (verified, orders fulfilled, member since, return policy) · 🟠 report review / report seller / report store · 🟠 buyer-protection explainer at checkout

**Orders**
🔴 Cancel + return actions on `/orders`, not only on the confirmation page · 🔴 dispute creation when a return is rejected · 🟠 tracking timeline · 🟠 return status timeline + instructions · 🟠 refund status (wire the existing `/payments/refunds`)

**Commerce**
🔴 Coupon field at checkout · 🔴 real shipping quote at checkout · 🟠 server-side cart · 🟡 saved payment methods · 🟡 guest checkout

**Account**
🔴 Email verification + phone OTP flows · 🟠 security activity log · 🟡 notification preferences · 🟡 back `/recently-viewed` and `/saved-searches` with real data or remove them

**Reviews**
🟠 seller responses displayed · 🟠 review photos · 🟡 helpfulness + sorting · 🟡 review history in account

**AI**
🟢 The AI assistant is architecturally correct. Add: comparison persistence, "why this was recommended" transparency, and an explicit "I only recommend from Mirwal's live catalogue" trust line.

---

## 20. PRIORITY ROADMAP

### Phase A — Launch blockers (must ship before any real seller touches Mirwal)

| # | Work | Why |
|---|---|---|
| A1 | **Defence-in-depth on seller status** — add `s.status='approved' AND s.deleted_at IS NULL` to every public catalogue query, and refuse `setProductApproval` for a non-approved seller | Suspension archiving is correct but is the only layer; approval can undo it |
| A2 | **Seller onboarding**: `seller_applications` + KYC columns + `seller_bank_accounts`; `POST /seller/apply`; real registration; wire the existing apply form | Nobody can join the marketplace |
| A3 | **KYC submission + review**: seller document upload UI (endpoint exists), document metadata (number, expiry), field-match review UI, `more_info_required`, reason codes, **PII access audit logging** | Verification currently reviews a queue nothing can fill |
| A4 | **Seller store is editable**: `PATCH /seller/me/store`, logo/banner upload, product image upload | A seller cannot list a product with a photo |
| A5 | **Complete the transactional messaging**: wire `order.confirmation`, `order.shipped`, payout and verification mail; add the SMS channel | Buyers get no order email; SMS is unused |
| A6 | **Email/phone verification** flows | Unverified contact details make everything downstream unenforceable |
| A7 | **Shipments & tracking**: `shipments` table, ship-with-tracking action, buyer tracking view, `failed_delivery` status | "Shipped" currently means nothing |
| A8 | **Real shipping fee** at checkout (quote endpoint already exists) | Every order total, GMV and commission figure is wrong today |
| A9 | **Payout safety**: hold period, reserve against open returns, clawback/negative balance — via `seller_ledger_entries` | Mirwal can pay out money it will owe back |
| A10 | **Coupons apply at checkout** or hide the marketing module until they do | Shipping a discount system that does not discount is worse than not shipping it |
| A11 | **Case model + product/seller/review reporting wired end to end** | Reporting is the only scalable safety mechanism |
| A12 | **Review moderation**: status, takedown route, review reports | A defamatory or fake review cannot be removed |
| A13 | **Roles & permissions split** (§12.3) + confirm `require_2fa_for_staff` is enforced at login | Today one role holds marketing, payouts and integrations |
| A14 | **Security alerts**: password/email/2FA/bank change + new-device login | Account takeover is undetectable |
| A15 | **Payment reconciliation sweep** for stuck `pending` attempts | Real money can be silently stranded |

### Phase B — Around launch (first 60 days)

B1 Dispute lifecycle + admin override of seller return decisions · B2 Enforcement actions + violations ledger + appeals · B3 Trust & risk scores (v1: verification + rating + cancellation + returns + upheld reports) · B4 Brand authorisations · B5 Tax (GST on orders, withholding on payouts, invoices) · B6 Seller performance page (seller-facing) with thresholds and automated warnings · B7 Automated product pre-checks (prohibited terms, duplicates, price sanity, image hashes) · B8 Admin Operations Queue dashboard · B9 Return lifecycle expansion (more-info, in-transit, received, replacement, evidence) · B10 Partial cancellation / partial refund · B11 `cancelled_by` on order items (buyer vs seller) · B12 Order-level buyer↔seller messaging · B13 Per-endpoint rate limiting · B14 Background job runner · B15 Notification preferences + digests.

### Phase C — Post-launch (60–180 days)

C1 Multi-account / linked-account detection · C2 Review-manipulation detection · C3 Buyer risk scoring + COD abuse controls · C4 Commission rules (per category/seller) · C5 Seller statements & reconciliation exports · C6 Bulk product import/export · C7 Outbound webhook dispatcher · C8 Admin bulk moderation tools + saved filters + assignment · C9 Server-side cart · C10 AI moderation assist · C11 Chargeback handling · C12 KYC retention & deletion policy.

### Phase D — Scale (180+ days)

D1 Multi-store per seller · D2 Dedicated search engine (FULLTEXT will run out) · D3 Warehouse/3PL integration · D4 Courier API integrations · D5 Seller mobile app · D6 Advanced fraud ML · D7 Restore-from-backup tooling · D8 Data warehouse for analytics.

---

## Appendix — the ten fastest high-value fixes

Ranked by (safety value) ÷ (effort). Every one is small.

1. Add `s.status = 'approved' AND s.deleted_at IS NULL` to the public catalogue queries, and a seller-status guard in `setProductApproval`. *(hours)*
2. Add `api.products.report()` to the storefront client and a "Report this listing" button on the PDP. *(hours — the endpoint is already built, tested and reachable)*
3. Log `document.viewed` to `audit_logs` on KYC document download. *(hours)*
4. Move cancel/return actions onto `/orders`. *(hours — components already exist)*
5. Wire `GET /payments/refunds` into the account UI. *(hours)*
6. Add `cancelled_by` to `order_items`. *(hours — unblocks every honest cancellation metric)*
7. Split `settings.manage` into `marketing.manage`, `payout.manage`, `integration.manage`, `shipping.manage`. *(a day)*
8. Add per-endpoint rate limits to upload, report, review and payout-request. *(a day)*
9. Delete the dead nav items and the unreferenced mock data files. *(an hour)*
10. Confirm and enforce `security.require_2fa_for_staff` at login. *(a day)*
