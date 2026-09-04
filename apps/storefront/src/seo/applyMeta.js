/**
 * Single writer for everything in <head> that varies per route.
 *
 * Every field is written on every call, and a field with no value has its tag removed rather
 * than being left behind. That is what stops metadata leaking from one route to the next.
 */

const MANAGED = 'data-mirwal-meta'

function upsertMeta(attribute, name, content) {
  const selector = `meta[${attribute}="${name}"]`
  const existing = document.head.querySelector(selector)

  if (!content) {
    if (existing?.hasAttribute(MANAGED)) existing.remove()
    return
  }

  const element = existing || document.head.appendChild(document.createElement('meta'))
  element.setAttribute(attribute, name)
  element.setAttribute(MANAGED, '')
  element.setAttribute('content', content)
}

function upsertCanonical(href) {
  const existing = document.head.querySelector('link[rel="canonical"]')

  if (!href) {
    existing?.remove()
    return
  }

  const link = existing || document.head.appendChild(Object.assign(document.createElement('link'), { rel: 'canonical' }))
  link.href = href
}

function upsertSchema(schema) {
  document.head.querySelector('script[data-mirwal-schema]')?.remove()
  if (!schema) return

  const script = document.createElement('script')
  script.type = 'application/ld+json'
  script.dataset.mirwalSchema = 'true'
  script.textContent = JSON.stringify(schema)
  document.head.appendChild(script)
}

/**
 * @param {object} meta
 * @param {string}  meta.title
 * @param {string} [meta.description]
 * @param {string} [meta.canonical]  omit or pass null for pages that must not be canonicalised
 * @param {string} [meta.image]
 * @param {string} [meta.robots]
 * @param {object} [meta.schema]     JSON-LD; omit to clear
 */
export function applyMeta({ title, description, canonical, image, robots, schema }) {
  if (title) document.title = title

  upsertMeta('name', 'description', description)
  upsertMeta('name', 'robots', robots)

  upsertMeta('property', 'og:type', 'website')
  upsertMeta('property', 'og:site_name', 'Mirwal')
  upsertMeta('property', 'og:title', title)
  upsertMeta('property', 'og:description', description)
  upsertMeta('property', 'og:url', canonical)
  upsertMeta('property', 'og:image', image)

  upsertMeta('name', 'twitter:card', image ? 'summary_large_image' : 'summary')
  upsertMeta('name', 'twitter:title', title)
  upsertMeta('name', 'twitter:description', description)
  upsertMeta('name', 'twitter:image', image)

  upsertCanonical(canonical)
  upsertSchema(schema)
}
