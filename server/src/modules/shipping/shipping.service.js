import { randomUUID } from 'node:crypto'
import { query, queryOne, withTransaction } from '../../db/pool.js'
import { badRequest, conflict, notFound } from '../../lib/errors.js'
import { formatMoney, toDecimal } from '../../lib/money.js'
import { parseJsonColumn } from '../../lib/json.js'
import { getSetting } from '../settings/settings.service.js'

/**
 * Shipping zones, methods, warehouses — and the quote that uses them.
 *
 * The admin Shipping pages previously said no shipping system existed. That was true of the
 * configuration but not of the need: `orders.shipping_fee` has always been charged, it was
 * simply always whatever the caller sent. `quote()` below is the point of the whole module —
 * without a caller, this would be three CRUD screens that decide nothing.
 *
 * Money is handled as strings throughout (see lib/money.js). A shipping fee that arrives as
 * 249.99000000000001 is a bug a customer notices.
 */

const slugify = (value) => String(value).toLowerCase().trim()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 140)

const normaliseCity = (value) => String(value ?? '').toLowerCase().trim()

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

function mapMethod(row) {
  return {
    id: row.public_id,
    name: row.name,
    description: row.description,
    carrier: row.carrier,
    rateType: row.rate_type,
    baseAmount: formatMoney(row.base_amount),
    freeOverAmount: row.free_over_amount === null ? null : formatMoney(row.free_over_amount),
    rateBps: row.rate_bps === null ? null : Number(row.rate_bps),
    minAmount: row.min_amount === null ? null : formatMoney(row.min_amount),
    maxAmount: row.max_amount === null ? null : formatMoney(row.max_amount),
    minDays: row.min_days === null ? null : Number(row.min_days),
    maxDays: row.max_days === null ? null : Number(row.max_days),
    sortOrder: Number(row.sort_order),
    isActive: Boolean(row.is_active),
  }
}

function mapZone(row, methods = []) {
  return {
    id: row.public_id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    countryCodes: parseJsonColumn(row.country_codes, []),
    cities: parseJsonColumn(row.cities, []),
    priority: Number(row.priority),
    isActive: Boolean(row.is_active),
    methodCount: methods.length,
    methods,
    createdAt: row.created_at,
  }
}

// ---------------------------------------------------------------------------
// Zones
// ---------------------------------------------------------------------------

export async function listZones({ includeInactive = true } = {}) {
  const zones = await query(
    `SELECT * FROM shipping_zones
      ${includeInactive ? '' : 'WHERE is_active = 1'}
      ORDER BY priority, name`,
  )
  if (zones.length === 0) return []

  const methods = await query(
    `SELECT m.*, z.public_id AS zone_public_id
       FROM shipping_methods m
       JOIN shipping_zones z ON z.id = m.zone_id
      ORDER BY m.sort_order, m.name`,
  )
  const byZone = new Map()
  for (const method of methods) {
    if (!byZone.has(method.zone_public_id)) byZone.set(method.zone_public_id, [])
    byZone.get(method.zone_public_id).push(mapMethod(method))
  }
  return zones.map((zone) => mapZone(zone, byZone.get(zone.public_id) ?? []))
}

export async function createZone({ name, description, countryCodes = ['PK'], cities = [], priority = 100, isActive = true }) {
  const slug = slugify(name)
  if (!slug) throw badRequest('A zone needs a name.', 'INVALID_ZONE_NAME')

  const existing = await queryOne('SELECT id FROM shipping_zones WHERE slug = ?', [slug])
  if (existing) throw conflict('A shipping zone with that name already exists.', 'DUPLICATE_ZONE')

  const publicId = randomUUID()
  await query(
    `INSERT INTO shipping_zones (public_id, name, slug, description, country_codes, cities, priority, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      publicId, name.trim(), slug, description?.trim() || null,
      JSON.stringify(countryCodes.map((code) => String(code).toUpperCase().slice(0, 2))),
      JSON.stringify(cities.map(normaliseCity).filter(Boolean)),
      priority, isActive ? 1 : 0,
    ],
  )
  const row = await queryOne('SELECT * FROM shipping_zones WHERE public_id = ?', [publicId])
  return mapZone(row)
}

export async function updateZone(publicId, patch) {
  const zone = await queryOne('SELECT * FROM shipping_zones WHERE public_id = ?', [publicId])
  if (!zone) throw notFound('Shipping zone not found.', 'ZONE_NOT_FOUND')

  const fields = []
  const params = []
  const set = (column, value) => { fields.push(`${column} = ?`); params.push(value) }

  if (patch.name !== undefined) { set('name', patch.name.trim()); set('slug', slugify(patch.name)) }
  if (patch.description !== undefined) set('description', patch.description?.trim() || null)
  if (patch.countryCodes !== undefined) {
    set('country_codes', JSON.stringify(patch.countryCodes.map((code) => String(code).toUpperCase().slice(0, 2))))
  }
  if (patch.cities !== undefined) set('cities', JSON.stringify(patch.cities.map(normaliseCity).filter(Boolean)))
  if (patch.priority !== undefined) set('priority', patch.priority)
  if (patch.isActive !== undefined) set('is_active', patch.isActive ? 1 : 0)

  if (fields.length === 0) return mapZone(zone)
  params.push(zone.id)
  await query(`UPDATE shipping_zones SET ${fields.join(', ')} WHERE id = ?`, params)

  const updated = await queryOne('SELECT * FROM shipping_zones WHERE id = ?', [zone.id])
  return mapZone(updated)
}

export async function deleteZone(publicId) {
  const zone = await queryOne('SELECT id, name FROM shipping_zones WHERE public_id = ?', [publicId])
  if (!zone) throw notFound('Shipping zone not found.', 'ZONE_NOT_FOUND')
  // Methods cascade with the zone; that is intended, a method has no meaning without one.
  await query('DELETE FROM shipping_zones WHERE id = ?', [zone.id])
  return { name: zone.name }
}

// ---------------------------------------------------------------------------
// Methods
// ---------------------------------------------------------------------------

/**
 * Reject a method whose numbers cannot produce a price.
 *
 * Done here rather than only in the zod schema because the requirement is conditional: what
 * makes a method valid depends on its rate type, and a shopper meeting an unpriceable method
 * at checkout is a worse failure than an admin meeting a validation message.
 */
function assertPriceable({ rateType, freeOverAmount, rateBps }) {
  if (rateType === 'free_over' && (freeOverAmount === null || freeOverAmount === undefined)) {
    throw badRequest('A "free over" method needs the basket value at which shipping becomes free.', 'MISSING_FREE_OVER')
  }
  if (rateType === 'percentage' && (rateBps === null || rateBps === undefined)) {
    throw badRequest('A percentage method needs a rate.', 'MISSING_RATE')
  }
}

export async function createMethod(zonePublicId, input) {
  const zone = await queryOne('SELECT id FROM shipping_zones WHERE public_id = ?', [zonePublicId])
  if (!zone) throw notFound('Shipping zone not found.', 'ZONE_NOT_FOUND')
  assertPriceable(input)

  if (input.minDays !== undefined && input.maxDays !== undefined
    && input.minDays !== null && input.maxDays !== null && input.minDays > input.maxDays) {
    throw badRequest('The fastest delivery estimate cannot be slower than the slowest.', 'INVALID_DELIVERY_WINDOW')
  }

  const publicId = randomUUID()
  await query(
    `INSERT INTO shipping_methods
       (public_id, zone_id, name, description, carrier, rate_type, base_amount,
        free_over_amount, rate_bps, min_amount, max_amount, min_days, max_days, sort_order, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      publicId, zone.id, input.name.trim(), input.description?.trim() || null, input.carrier?.trim() || null,
      input.rateType, toDecimal(input.baseAmount ?? 0),
      toDecimal(input.freeOverAmount),
      input.rateBps ?? null,
      toDecimal(input.minAmount),
      toDecimal(input.maxAmount),
      input.minDays ?? null, input.maxDays ?? null,
      input.sortOrder ?? 100, input.isActive === false ? 0 : 1,
    ],
  )
  const row = await queryOne('SELECT * FROM shipping_methods WHERE public_id = ?', [publicId])
  return mapMethod(row)
}

export async function updateMethod(publicId, patch) {
  const method = await queryOne('SELECT * FROM shipping_methods WHERE public_id = ?', [publicId])
  if (!method) throw notFound('Shipping method not found.', 'METHOD_NOT_FOUND')

  assertPriceable({
    rateType: patch.rateType ?? method.rate_type,
    freeOverAmount: patch.freeOverAmount !== undefined ? patch.freeOverAmount : method.free_over_amount,
    rateBps: patch.rateBps !== undefined ? patch.rateBps : method.rate_bps,
  })

  const fields = []
  const params = []
  const set = (column, value) => { fields.push(`${column} = ?`); params.push(value) }

  if (patch.name !== undefined) set('name', patch.name.trim())
  if (patch.description !== undefined) set('description', patch.description?.trim() || null)
  if (patch.carrier !== undefined) set('carrier', patch.carrier?.trim() || null)
  if (patch.rateType !== undefined) set('rate_type', patch.rateType)
  if (patch.baseAmount !== undefined) set('base_amount', toDecimal(patch.baseAmount))
  if (patch.freeOverAmount !== undefined) set('free_over_amount', toDecimal(patch.freeOverAmount))
  if (patch.rateBps !== undefined) set('rate_bps', patch.rateBps)
  if (patch.minAmount !== undefined) set('min_amount', toDecimal(patch.minAmount))
  if (patch.maxAmount !== undefined) set('max_amount', toDecimal(patch.maxAmount))
  if (patch.minDays !== undefined) set('min_days', patch.minDays)
  if (patch.maxDays !== undefined) set('max_days', patch.maxDays)
  if (patch.sortOrder !== undefined) set('sort_order', patch.sortOrder)
  if (patch.isActive !== undefined) set('is_active', patch.isActive ? 1 : 0)

  if (fields.length === 0) return mapMethod(method)
  params.push(method.id)
  await query(`UPDATE shipping_methods SET ${fields.join(', ')} WHERE id = ?`, params)

  return mapMethod(await queryOne('SELECT * FROM shipping_methods WHERE id = ?', [method.id]))
}

export async function deleteMethod(publicId) {
  const method = await queryOne('SELECT id, name FROM shipping_methods WHERE public_id = ?', [publicId])
  if (!method) throw notFound('Shipping method not found.', 'METHOD_NOT_FOUND')
  await query('DELETE FROM shipping_methods WHERE id = ?', [method.id])
  return { name: method.name }
}

// ---------------------------------------------------------------------------
// Warehouses
// ---------------------------------------------------------------------------

const mapWarehouse = (row) => ({
  id: row.public_id,
  name: row.name,
  code: row.code,
  addressLine: row.address_line,
  city: row.city,
  region: row.region,
  postalCode: row.postal_code,
  countryCode: row.country_code,
  contactPhone: row.contact_phone,
  isDefault: Boolean(row.is_default),
  isActive: Boolean(row.is_active),
  createdAt: row.created_at,
})

export async function listWarehouses() {
  const rows = await query('SELECT * FROM warehouses ORDER BY is_default DESC, name')
  return rows.map(mapWarehouse)
}

export async function createWarehouse(input) {
  const code = String(input.code).toUpperCase().trim()
  const existing = await queryOne('SELECT id FROM warehouses WHERE code = ?', [code])
  if (existing) throw conflict('A warehouse with that code already exists.', 'DUPLICATE_WAREHOUSE')

  const publicId = randomUUID()
  await withTransaction(async (connection) => {
    // Exactly one default. Clearing first keeps that true without a partial-unique index,
    // which MariaDB does not have.
    if (input.isDefault) await connection.query('UPDATE warehouses SET is_default = 0')
    await connection.query(
      `INSERT INTO warehouses
         (public_id, name, code, address_line, city, region, postal_code, country_code, contact_phone, is_default, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        publicId, input.name.trim(), code, input.addressLine?.trim() ?? '', input.city.trim(),
        input.region?.trim() ?? '', input.postalCode?.trim() ?? '',
        (input.countryCode ?? 'PK').toUpperCase(), input.contactPhone?.trim() ?? '',
        input.isDefault ? 1 : 0, input.isActive === false ? 0 : 1,
      ],
    )
  })
  return mapWarehouse(await queryOne('SELECT * FROM warehouses WHERE public_id = ?', [publicId]))
}

export async function updateWarehouse(publicId, patch) {
  const warehouse = await queryOne('SELECT * FROM warehouses WHERE public_id = ?', [publicId])
  if (!warehouse) throw notFound('Warehouse not found.', 'WAREHOUSE_NOT_FOUND')

  const columns = {
    name: 'name', addressLine: 'address_line', city: 'city', region: 'region',
    postalCode: 'postal_code', contactPhone: 'contact_phone',
  }
  const fields = []
  const params = []
  for (const [key, column] of Object.entries(columns)) {
    if (patch[key] !== undefined) { fields.push(`${column} = ?`); params.push(String(patch[key]).trim()) }
  }
  if (patch.countryCode !== undefined) { fields.push('country_code = ?'); params.push(patch.countryCode.toUpperCase()) }
  if (patch.isActive !== undefined) { fields.push('is_active = ?'); params.push(patch.isActive ? 1 : 0) }

  await withTransaction(async (connection) => {
    if (patch.isDefault === true) {
      await connection.query('UPDATE warehouses SET is_default = 0')
      fields.push('is_default = 1')
    } else if (patch.isDefault === false) {
      fields.push('is_default = 0')
    }
    if (fields.length > 0) {
      await connection.query(`UPDATE warehouses SET ${fields.join(', ')} WHERE id = ?`, [...params, warehouse.id])
    }
  })

  return mapWarehouse(await queryOne('SELECT * FROM warehouses WHERE id = ?', [warehouse.id]))
}

export async function deleteWarehouse(publicId) {
  const warehouse = await queryOne('SELECT id, name, is_default FROM warehouses WHERE public_id = ?', [publicId])
  if (!warehouse) throw notFound('Warehouse not found.', 'WAREHOUSE_NOT_FOUND')
  if (warehouse.is_default) {
    const others = await queryOne('SELECT COUNT(*) AS total FROM warehouses WHERE id <> ?', [warehouse.id])
    // Removing the default while others remain would leave dispatch with no origin at all.
    if (Number(others.total) > 0) {
      throw conflict('Make another warehouse the default before removing this one.', 'DEFAULT_WAREHOUSE')
    }
  }
  await query('DELETE FROM warehouses WHERE id = ?', [warehouse.id])
  return { name: warehouse.name }
}

// ---------------------------------------------------------------------------
// Quoting — what the configuration is for
// ---------------------------------------------------------------------------

/**
 * The shipping options available for one destination and basket value.
 *
 * Zone matching is deliberately narrow-to-broad: the lowest `priority` wins, so a
 * "Karachi same-day" zone can sit in front of a nationwide zone without either being
 * deleted. If nothing matches, the `shipping.default_fee` setting is returned as a single
 * option rather than an empty list — a checkout with no shippable option is a dead end.
 */
export async function quote({ countryCode = 'PK', city = '', subtotal = '0' } = {}) {
  const zones = await query(
    'SELECT * FROM shipping_zones WHERE is_active = 1 ORDER BY priority, id',
  )
  const wantedCountry = String(countryCode).toUpperCase()
  const wantedCity = normaliseCity(city)

  const match = zones.find((zone) => {
    const countries = parseJsonColumn(zone.country_codes, [])
    const cities = parseJsonColumn(zone.cities, [])
    const countryOk = countries.length === 0 || countries.includes(wantedCountry)
    const cityOk = cities.length === 0 || (wantedCity && cities.includes(wantedCity))
    return countryOk && cityOk
  })

  if (!match) {
    const fallback = await getSetting('shipping.default_fee', 0)
    return {
      zone: null,
      options: [{
        id: 'default',
        name: 'Standard delivery',
        description: 'No shipping zone covers this address, so the platform default applies.',
        carrier: null,
        // toDecimal first: every money value the API returns is a 2-dp string, and a quote
        // answering "199" where the rest of the API says "199.00" makes any client that
        // compares or sums the two subtly wrong.
        amount: formatMoney(toDecimal(fallback ?? 0)),
        isFree: Number(fallback ?? 0) === 0,
        minDays: null,
        maxDays: null,
      }],
    }
  }

  const methods = await query(
    'SELECT * FROM shipping_methods WHERE zone_id = ? AND is_active = 1 ORDER BY sort_order, name',
    [match.id],
  )

  const basket = Number(subtotal)
  const options = methods.map((method) => {
    let amount = Number(method.base_amount)
    let isFree = false

    if (method.rate_type === 'free_over' && method.free_over_amount !== null
      && basket >= Number(method.free_over_amount)) {
      amount = 0
      isFree = true
    } else if (method.rate_type === 'percentage' && method.rate_bps !== null) {
      amount = (basket * Number(method.rate_bps)) / 10_000
      if (method.min_amount !== null) amount = Math.max(amount, Number(method.min_amount))
      if (method.max_amount !== null) amount = Math.min(amount, Number(method.max_amount))
    }

    return {
      id: method.public_id,
      name: method.name,
      description: method.description,
      carrier: method.carrier,
      amount: formatMoney(toDecimal(amount)),
      isFree: isFree || amount === 0,
      minDays: method.min_days === null ? null : Number(method.min_days),
      maxDays: method.max_days === null ? null : Number(method.max_days),
    }
  })

  return { zone: { id: match.public_id, name: match.name }, options }
}

/** Zone/method/warehouse counts for the admin overview. */
export async function stats() {
  const row = await queryOne(
    `SELECT (SELECT COUNT(*) FROM shipping_zones)                  AS zones,
            (SELECT COUNT(*) FROM shipping_zones WHERE is_active)  AS active_zones,
            (SELECT COUNT(*) FROM shipping_methods)                AS methods,
            (SELECT COUNT(*) FROM shipping_methods WHERE is_active) AS active_methods,
            (SELECT COUNT(*) FROM warehouses WHERE is_active)      AS warehouses`,
  )
  return {
    zones: Number(row.zones),
    activeZones: Number(row.active_zones),
    methods: Number(row.methods),
    activeMethods: Number(row.active_methods),
    warehouses: Number(row.warehouses),
  }
}
