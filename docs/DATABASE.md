# MIRWAL — Database

**Target:** MariaDB 10.11.x (LTS), InnoDB, on cPanel shared hosting
**Status:** Local development schema implemented and verified on MariaDB 10.11.16. Production deployment still blocked on the verification in §2.

---

## 1. Target environment

Reported from the production cPanel inspection:

| Property | Value |
|---|---|
| Engine | MariaDB (**not** MySQL 8) |
| Version | 10.11.16-MariaDB-cll-lve |
| Storage engine | InnoDB |
| Protocol | 10 |
| Server / default charset | **latin1 / cp1252** |

`-cll-lve` indicates CloudLinux with LVE resource limits — shared hosting with per-account CPU, memory, I/O and connection caps. That is a real design constraint, not a footnote: connection pools must be small, long transactions are risky, and heavy analytics queries will be throttled rather than merely slow.

### The charset problem

The server default is latin1/cp1252. Mirwal must never inherit it.

latin1 cannot represent Urdu, Arabic or emoji **at all**. A latin1 column does not reject those characters — under a non-strict `sql_mode` it silently substitutes or truncates them, so the corruption is invisible until a customer reports a mangled product name. Every Mirwal database, table and column is therefore created with an explicit `utf8mb4` charset and an explicit collation. Nothing relies on a server default.

---

## 2. Verification status

### What is now verified (locally)

A project-local MariaDB **10.11.16** — the exact production build — runs on port 3307 from
`D:\mirwal-devdb` (portable ZIP, SHA256 checked against MariaDB's published value; no
Windows service, no system-wide install). Its server default is deliberately set to
**latin1**, mirroring production, so any migration that forgets an explicit `utf8mb4`
fails in development instead of silently corrupting data in production.

Measured on that instance rather than assumed:

| Question | Answer |
|---|---|
| Is `utf8mb4_unicode_520_ci` available on 10.11? | Yes |
| What is the utf8mb4 default collation on 10.11? | `utf8mb4_general_ci` — so Mirwal names its collation explicitly |
| Do `utf8mb4_uca1400_*` collations exist? | No — 11.5+ only, correctly avoided |
| Does the schema store Urdu, Arabic and emoji? | Yes — verified end to end, HTTP → API → DB → API |
| Do CHECK constraints enforce? | Yes — 8/8 constraint tests pass |
| Do foreign keys and cascades work? | Yes — 18 FKs, cascade delete verified |
| Are migrations reproducible from zero? | Yes — `migrate fresh` rebuilds 15 tables, 18 FKs, 0 non-utf8mb4 columns |

**A correction to an earlier assumption in this document:** table and column charset inherit
from the **database**, not the server. A latin1 server default only matters at
`CREATE DATABASE` time. The practical risk is therefore narrower but sharper — cPanel's
database-creation UI creates the database with the server default, and every table then
inherits latin1. The migration runner handles this by issuing `ALTER DATABASE ... utf8mb4`
before applying anything, *and* declaring charset per-table, so it is correct regardless of
how the database was created.

### What is still unverified (production)

| Item | Status |
|---|---|
| Version, charset, engine (as reported) | Provided by you from the cPanel inspection |
| Actual `character_set_database` / `collation_database` | **Unverified** |
| `lower_case_table_names` | **Unverified** — local Windows is 1; production Linux is likely 0. Mitigated by using lowercase names everywhere |
| `sql_mode` | **Unverified** |
| Existing tables, columns, foreign keys | **Unverified** — unknown whether the database is empty |
| Privileges of the app account, especially `REFERENCES` | **Unverified** — without it, FK clauses can be silently ignored |

There are still no production credentials in this repository, and none are needed for
development. Production deployment of these migrations must not happen until
[`docs/db/verify-environment.sql`](db/verify-environment.sql) has been run in phpMyAdmin
and its output reviewed. That script is strictly read-only — 11 `SELECT`, 1 `SHOW`, zero
write statements.

## 3. MariaDB 10.11 design decisions

These are the points where MariaDB differs from MySQL 8 in ways that actually change the schema. Designing for MySQL 8 and hoping it ports is how you get a migration that runs locally and fails on the server.

### 3.1 `JSON` is not a real type

In MariaDB, `JSON` is an **alias for `LONGTEXT COLLATE utf8mb4_bin`**. It is stored as text, not MySQL's binary representation. Consequences:

- MySQL's `->` and `->>` operators **do not exist** in 10.11. Use `JSON_EXTRACT()` and `JSON_VALUE()`.
- JSON values compare as **strings**, not by JSON semantics.
- Validity is not enforced by the type. Add `CHECK (JSON_VALID(col))` explicitly.
- JSON paths cannot be indexed directly. Index a persistent generated column extracting the value instead.

Mirwal will use JSON sparingly — product attributes and audit-log payloads — and model anything queried or filtered as real columns.

### 3.2 Collation must be named explicitly

On 10.11 the default collation for `utf8mb4` is still `utf8mb4_general_ci`, which has poor Unicode ordering. The modern `utf8mb4_uca1400_*` collations arrived in **11.5+** and the default changed in **11.6/11.8** — none of that is available here, and code written against those names will not run.

**Decision:** `utf8mb4` / `utf8mb4_unicode_520_ci` (UCA 5.2.0) as the database and table default. Named explicitly everywhere, so a future upgrade to 11.x or 12.x does not silently change sorting or unique-key behaviour.

**Caveat:** `_ci` is case- and accent-insensitive, which affects `UNIQUE` constraints. `Ali@x.com` and `ali@x.com` would collide — usually desirable for email, rarely desirable for SKUs or tokens. Identifier columns (slug, SKU, API token, order reference) will use `utf8mb4_bin` for deterministic comparison.

### 3.3 Money is `DECIMAL`, never float

Prices are `DECIMAL(12,2)`; order and payout totals are `DECIMAL(14,2)` to leave room for aggregation. This also replaces the current front-end model, where every price is a formatted string (`'Rs. 234,000'`) re-parsed with a regex in six different files — see `PROJECT_AUDIT.md` §5, D-2.

### 3.4 Timestamps: `DATETIME` in UTC, not `TIMESTAMP`

MariaDB 10.11's `TIMESTAMP` is still 32-bit and **overflows in 2038**. The fix shipped in 11.8, which is not available here. Order and audit records must outlive that.

**Decision:** `DATETIME(3)` storing UTC, with conversion at the application boundary. Also avoids depending on server time-zone tables, which cPanel hosts frequently do not load (`@@time_zone` is typically `SYSTEM`).

### 3.5 Row format must be `DYNAMIC`

A `utf8mb4 VARCHAR(255)` index is 1020 bytes, which exceeds the 767-byte index limit of the older `COMPACT`/`REDUNDANT` row formats. `DYNAMIC` raises that to 3072 bytes. 10.11 defaults to `DYNAMIC`, but the verification script confirms it rather than assuming — and every table declares `ROW_FORMAT=DYNAMIC` explicitly.

### 3.6 `AUTO_INCREMENT` is not persisted across restarts

Unlike MySQL 8, MariaDB recalculates the counter as `MAX(id) + 1` on restart, so ids can be **reused** after a restart if the highest rows were deleted.

**Consequence:** never expose an auto-increment id as a customer-facing order number. Orders get a separate, independently-generated `order_reference` that is unique and never reused.

### 3.7 `lower_case_table_names` — the dev/prod trap

Production is Linux (normally `0`, case-sensitive). A Windows dev machine is `1` or `2`. A mismatch produces "table doesn't exist" errors that appear **only in production**.

**Decision:** all table and column names are lowercase `snake_case`, always, with no exceptions. The verification script reports the production value so the dev instance can be configured to match.

### 3.8 Foreign keys need the `REFERENCES` privilege

cPanel-provisioned accounts sometimes lack `REFERENCES`. Without it, `FOREIGN KEY` clauses can be **silently ignored** rather than erroring, producing a schema that looks correct locally and has no referential integrity in production. §7 of the verification script checks this.

### 3.9 Features that *are* available and worth using

| Feature | Since | Use in Mirwal |
|---|---|---|
| `CHECK` constraints | 10.2 | Enum-ish guards, `JSON_VALID`, non-negative money/stock |
| Window functions, CTEs | 10.2 | Analytics without N+1 |
| `INSERT ... RETURNING` | 10.5 | Fetch generated ids without a round trip |
| `SELECT ... SKIP LOCKED` | 10.6 | Job queue workers (Phase 15) without contention |
| Native `UUID` type | 10.7 | Public-facing opaque identifiers |
| Descending indexes | 10.8 | `ORDER BY created_at DESC` paths |
| Sequences | 10.3 | Order reference generation (see §3.6) |

### 3.10 Features to avoid — MySQL 8 only

`->` / `->>` JSON operators; native binary JSON semantics; `utf8mb4_0900_*` collations; `utf8mb4_uca1400_*` collations (11.5+); lateral derived tables; CIDR notation in user accounts; persisted `AUTO_INCREMENT`; MySQL's multi-role activation semantics.

---

## 4. Migration principles

1. **Never touch production directly.** Migrations run against a local 10.11.x instance first, then a staging copy, then production.
2. **Forward-only, numbered, idempotent to apply once.** Each migration records itself in a `schema_migrations` table so a fresh database and an existing one converge.
3. **Reproducible on an empty database.** Running every migration in order against a fresh MariaDB 10.11.x must produce the exact production schema. This is verified in CI, not assumed.
4. **Every migration has a tested rollback**, or is explicitly marked irreversible with the reason.
5. **No destructive change without a backup step** and an explicit confirmation in the runbook.
6. **DDL is not transactional in MariaDB.** A migration that fails halfway leaves partial DDL behind. Each migration therefore makes one logical change, so a failure is easy to reason about.
7. **Charset and collation are stated explicitly** on every `CREATE DATABASE`, `CREATE TABLE` and character column.

---

## 5. Local development environment

Local must match production closely enough that migrations behave identically. `winget` only offers MariaDB **12.3**, and Chocolatey's default is also 12.x — both are far past the 11.5/11.6/11.8 collation and timestamp changes, so they would mask exactly the incompatibilities we care about.

Two ways to get an exact 10.11.16:

| Option | Command / file | Trade-off |
|---|---|---|
| **A. Portable ZIP** (recommended) | `mariadb-10.11.16-winx64.zip`, SHA256 `b1659bd9fe816624632c6b445ce4ad1ed6758a199e35f89e2448aef99828527b` | No admin rights, no Windows service, no system-wide change, runs on a custom port, removed by deleting the folder |
| **B. Chocolatey** | `choco install mariadb --version=10.11.16` | Installs a Windows service; needs an elevated shell; system-wide |

Chocolatey does publish the full 10.11 line (10.11.7 through 10.11.19), so B is viable if you prefer a managed install.

**Done.** Option A was used: `D:\mirwal-devdb` holds the portable 10.11.16 build, its data directory and `my.ini`. Nothing was installed system-wide, no Windows service was registered, and deleting that folder removes it completely. The server listens on **port 3307** to avoid clashing with anything else.

Start it with:

```
D:\mirwal-devdb\mariadb-10.11.16-winx64\bin\mariadbd.exe --defaults-file=D:\mirwal-devdb\my.ini --datadir=D:\mirwal-devdb\data --console
```

Then, from `server/`: `npm run migrate` and `npm run seed` (or `npm run db:reset` to rebuild).

---

## 6. Open questions

1. **Run the verification script** and send the results (§2). Sections 1, 2, 3, 6, 7 are the decision-changing ones.
2. **Is the Mirwal production database empty, or does it already hold data?** This determines whether Phase 0.5 writes an initial schema or a migration over an existing one.
3. **Local MariaDB: option A or B** from §5?
4. **Where does the backend run?** cPanel shared hosting with CloudLinux/LVE supports Node via Passenger, but with hard resource caps. If the API is going somewhere else (a VPS, a container host) while the database stays on cPanel, remote database latency and connection limits become a primary design constraint. This changes the architecture materially and I would rather know before writing it.
5. **Confirm the collation choice** in §3.2 — `utf8mb4_unicode_520_ci` with `utf8mb4_bin` for identifier columns.

---

## Sources

- [Incompatibilities and Feature Differences Between MariaDB 10.11 and MySQL 8.0](https://mariadb.com/docs/release-notes/community-server/about/compatibility-and-differences/incompatibilities-and-feature-differences-between-mariadb-10-11-and-mysql-8)
- [JSON Data Type — MariaDB Documentation](https://mariadb.com/docs/server/reference/data-types/string-data-types/json)
- [Making MariaDB understand MySQL JSON — mariadb.org](https://mariadb.org/making-mariadb-understand-mysql-json/)
- [What's new in MariaDB 10.6 (SKIP LOCKED)](https://mariadb.com/docs/release-notes/community-server/10.6/what-is-mariadb-106)
- [Supported Character Sets and Collations — MariaDB Documentation](https://mariadb.com/docs/server/reference/data-types/string-data-types/character-sets/supported-character-sets-and-collations)
- [MariaDB 11.8 LTS adds vector search, fixes Year 2038, upgrades Unicode support](https://alternativeto.net/news/2025/6/mariadb-11-8-lts-adds-vector-search-fixes-year-2038-upgrades-unicode-support)
