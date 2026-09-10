# Deploying Mirwal

Four things ship: one Node API and three static single-page apps.

| Piece | Workspace | Build output | Runtime |
| --- | --- | --- | --- |
| API | `server` | — | Node ≥20, long-running process |
| Storefront | `apps/storefront` | `dist/` | static files |
| Seller Centre | `apps/seller` | `dist/` | static files |
| Admin | `apps/admin` | `dist/` | static files |

The three apps are static once built. They need a web server that can serve
files and rewrite unknown paths to `index.html` — nothing more.

---

## Before the first deploy

### 1. Database

MariaDB 10.11. Create the database and a user that owns it:

```sql
CREATE DATABASE mirwal CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'mirwal'@'localhost' IDENTIFIED BY '<a generated password>';
GRANT ALL PRIVILEGES ON mirwal.* TO 'mirwal'@'localhost';
FLUSH PRIVILEGES;
```

The character set matters. The migration runner checks it at boot and refuses
to continue against latin1, because a cPanel-created database silently defaults
to it and every Urdu product name would be mangled beyond recovery.

### 2. Secrets

Generate fresh values — do not carry development secrets forward:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

One for `JWT_ACCESS_SECRET`, another for `JWT_REFRESH_SECRET`. Rotating either
signs every existing session out, which is the intended behaviour but should be
a decision rather than a surprise.

### 3. Server environment

Copy `server/.env.example` to `server/.env` and fill it in. `src/config/env.js`
refuses to boot on a missing or still-`change-me` value for `DB_USER`,
`DB_NAME`, `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET`, so a misconfigured
server fails loudly at startup rather than quietly at the first request.

These differ from their development values and none of them are enforced by
code — each is a setting someone has to change:

| Variable | Development | Production | If you miss it |
| --- | --- | --- | --- |
| `NODE_ENV` | `development` | `production` | `migrate:fresh` and `seed` stay available; both drop or overwrite real data |
| `REFRESH_COOKIE_SECURE` | `false` | `true` | The refresh cookie travels over plain HTTP |
| `REFRESH_COOKIE_SAMESITE` | `lax` | `none` if the apps are on different sites to the API, otherwise `lax` | Cross-site auth silently fails |
| `CORS_ORIGINS` | localhost ports | the three real origins, comma-separated | Every authenticated request fails and the apps look broken with no error |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | dev values | freshly generated | Tokens forgeable by anyone who has seen the dev machine |
| `MIRWAL_TEST` | set by the test suite | **never set** | The global rate limiter is relaxed in production |
| `SMTP_HOST` | often unset | real SMTP | Order confirmations and password resets skip silently, by design |
| `SMS_API_URL` / `SMS_API_KEY` | unset | gateway credentials | Phone OTP sends nothing |
| `UPLOAD_DIR` / `BACKUP_DIR` | under `server/storage` | a path outside any web root | Seller CNIC and bank documents become publicly fetchable |

`CORS_ORIGINS` is an exact-match allowlist — the API compares the `Origin`
header against the list literally, so `*` matches nothing and is not a usable
shortcut. Name each origin exactly, scheme included:

```
CORS_ORIGINS=https://mirwal.pk,https://seller.mirwal.pk,https://admin.mirwal.pk
```

### 4. Payment providers

Stripe, EasyPaisa and JazzCash each need live credentials. Set
`PAYMENT_RETURN_URL_BASE` to the real storefront origin, and register the
Stripe webhook against `<API origin>/payments/webhooks/stripe`, storing the
signing secret in `STRIPE_WEBHOOK_SECRET`.

The webhook router is mounted before `express.json()` so Stripe's raw-body
signature verifies, and before the rate limiter so provider retries are never
throttled. Neither can be reordered without breaking payments.

---

## Deploying

### API

```bash
npm ci
npm run migrate --workspace mirwal-server   # forward-only; safe to re-run
npm start --workspace mirwal-server
```

Run it under a process manager that restarts on exit — pm2, systemd, or your
host's Node app runner. Behind a reverse proxy, keep `trust proxy` working by
forwarding `X-Forwarded-For`, or rate limiting and audit logs record the
proxy's IP for every request.

Never run `migrate:fresh` or `seed` against production. Both throw under
`NODE_ENV=production`, which is the safety net, not the plan.

### The three apps

`VITE_*` values are inlined into the bundle at build time. A wrong value needs
a rebuild, not a restart — this is the single most common deploy mistake here.

```bash
VITE_API_BASE_URL=https://api.mirwal.pk npm run build:storefront
VITE_API_BASE_URL=https://api.mirwal.pk npm run build:seller
VITE_API_BASE_URL=https://api.mirwal.pk npm run build:admin
```

Each also takes `VITE_STOREFRONT_URL`, `VITE_SELLER_URL` and `VITE_ADMIN_URL`
for cross-app links; see each app's `.env.example`. Upload the resulting
`dist/` directories.

### Web server

Every app is client-routed. Without a rewrite, a buyer who refreshes on a
product page — or opens a shared link to one — gets a 404 from the web server
before React ever loads.

```nginx
server {
    server_name mirwal.pk;
    root /var/www/mirwal/storefront;

    location / {
        try_files $uri $uri/ /index.html;
    }

    # Hashed filenames are safe to cache forever; index.html never is.
    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
```

Repeat per app. `admin` and `seller` already send `noindex` headers in their
HTML, but keeping them off public DNS is the stronger control.

---

## After deploying

Check, in order:

1. `GET /health` returns 200. Point an uptime monitor at it.
2. Sign in to each of the three apps — a failure here is almost always
   `CORS_ORIGINS` or the cookie flags.
3. Hard-refresh a deep link on each app (a product page, `/orders`,
   `/sellers`). A 404 means the rewrite is missing.
4. `npm run migrate:status --workspace mirwal-server` lists every migration as
   applied.
5. Place a test order end to end and confirm the webhook marks it paid.

---

## Backups and rollback

Migrations are forward-only by design — MariaDB has no transactional DDL, so a
half-applied migration cannot be rolled back automatically. **Rollback means
restore.** That makes the backup the rollback plan, not a precaution.

```bash
mysqldump --single-transaction --routines --databases mirwal \
  | gzip > mirwal-$(date +%F-%H%M).sql.gz
```

Schedule it, write it somewhere that is not the application server, and
restore one into a scratch database before launch. A backup that has never
been restored is a hypothesis.

`server/storage/` holds seller KYC documents and is not in the database. Back
it up too, and keep it out of any web root.

---

## Known gaps

Tracked, not yet done:

- No container or process definition — no `Dockerfile`, no `Procfile`.
- No structured logging. `LOG_LEVEL` is read but there is no logger behind it.
- No error tracking on the server or in the apps.
- No CSRF token on the cookie-driven refresh endpoint. Access tokens are
  header-based so they are not CSRF-reachable; the refresh cookie is httpOnly
  and path-scoped per role, which narrows it, but the check is absent.
- Two moderate `qs` advisories reachable through Express 4.22.2, which pins
  `qs ~6.15.1`. The fix is `qs@6.16.0`, outside that range. Revisit when
  Express ships a release that depends on `^6.16.0`.
- Social preview tags are injected by JavaScript, so crawlers that do not run
  it — WhatsApp among them — see an incomplete card.
- `server/.env.example` declares `REFRESH_COOKIE_NAME`, `REFRESH_COOKIE_SECURE`
  and `REFRESH_COOKIE_SAMESITE` twice.
- `server/package-lock.json` sits alongside the root lockfile. A workspace
  member should not carry its own; it causes root `overrides` to be ignored.
