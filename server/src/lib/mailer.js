import nodemailer from 'nodemailer'
import { env } from '../config/env.js'

/**
 * Transactional email and SMS transport.
 *
 * Mirwal previously sent nothing at all, and the admin panel's messaging pages were toggles
 * over an absence. This is the capability that makes them real.
 *
 * The contract every caller relies on: **sending never throws.** A failed send returns a
 * result describing the failure instead, because a bounced confirmation email must not roll
 * back the order it was confirming. The caller records the result; the operation continues.
 *
 * Three outcomes, deliberately distinct:
 *
 *   sent    — the provider accepted it.
 *   failed  — a provider was configured and refused it. Something is wrong.
 *   skipped — no provider is configured, so nothing was attempted. Not a failure; the
 *             deployment simply has no mail set up, and the delivery log says so plainly
 *             rather than showing a red error an operator would chase.
 */

let transporter = null

/** Built lazily and reused: creating a transport per message re-opens the SMTP connection. */
function getTransport() {
  if (!env.mail.enabled) return null
  transporter ??= nodemailer.createTransport({
    host: env.mail.host,
    port: env.mail.port,
    secure: env.mail.secure,
    ...(env.mail.user ? { auth: { user: env.mail.user, pass: env.mail.password } } : {}),
  })
  return transporter
}

/** Verify the SMTP settings actually connect. Used by the admin "test connection" action. */
export async function verifyMailTransport() {
  const transport = getTransport()
  if (!transport) return { ok: false, reason: 'SMTP is not configured. Set SMTP_HOST in the API environment.' }
  try {
    await transport.verify()
    return { ok: true, host: env.mail.host, port: env.mail.port }
  } catch (error) {
    return { ok: false, reason: error.message }
  }
}

/**
 * Send one email.
 *
 * @returns {Promise<{status:'sent'|'failed'|'skipped', provider?:string, ref?:string, error?:string}>}
 */
export async function sendEmail({ to, subject, html, text }) {
  const transport = getTransport()
  if (!transport) {
    return { status: 'skipped', error: 'SMTP is not configured.' }
  }
  try {
    const info = await transport.sendMail({
      from: env.mail.from,
      ...(env.mail.replyTo ? { replyTo: env.mail.replyTo } : {}),
      to,
      subject,
      // Both parts: a text alternative keeps the message readable in clients that refuse
      // HTML, and its absence is a common spam signal.
      text: text ?? stripHtml(html ?? ''),
      html,
    })
    return { status: 'sent', provider: 'smtp', ref: info.messageId }
  } catch (error) {
    return { status: 'failed', provider: 'smtp', error: error.message }
  }
}

/**
 * Send one SMS through a generic HTTP gateway.
 *
 * Deliberately not tied to one vendor's SDK: Pakistani providers differ, and most accept a
 * POST with an api key, a recipient and a message. `SMS_API_URL` points at whichever is in
 * use; swapping providers is configuration, not a code change.
 */
export async function sendSms({ to, body }) {
  if (!env.sms.enabled) {
    return { status: 'skipped', error: 'No SMS gateway is configured.' }
  }
  try {
    const response = await fetch(env.sms.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.sms.apiKey}`,
      },
      body: JSON.stringify({ to, from: env.sms.sender, message: body }),
      // Without this a hanging gateway would hold the request open indefinitely.
      signal: AbortSignal.timeout(10_000),
    })
    const payload = await response.text()
    if (!response.ok) {
      return { status: 'failed', provider: 'sms', error: `Gateway returned ${response.status}: ${payload.slice(0, 200)}` }
    }
    return { status: 'sent', provider: 'sms', ref: payload.slice(0, 200) }
  } catch (error) {
    return { status: 'failed', provider: 'sms', error: error.message }
  }
}

/** A plain-text alternative from the HTML body. Crude on purpose — it is a fallback. */
/**
 * The plain-text alternative for an HTML email.
 *
 * Two things this has to get right, because a plain-text reader sees only this part:
 *
 *  - A link must survive as its URL. Reducing `<a href="…">Reset your password</a>` to the
 *    words "Reset your password" leaves the recipient with an instruction and no way to
 *    follow it, which for a password reset means the email does not work at all.
 *  - Entities must be decoded. `&mdash;` rendered literally is visible sloppiness in
 *    something Mirwal sends to customers.
 */
function stripHtml(html) {
  return String(html)
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    // Keep the destination: "text (https://…)", the usual plain-text convention. A link whose
    // text already is the URL is left alone rather than repeated.
    .replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
      (_match, href, text) => {
        const label = text.replace(/<[^>]+>/g, '').trim()
        return !label || label === href ? href : `${label} (${href})`
      })
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&rsquo;/g, '’')
    .replace(/&lsquo;/g, '‘')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    // Ampersand last: decoding it first would turn "&amp;lt;" into a real "<".
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Fill `{{placeholders}}` in a template.
 *
 * Values are HTML-escaped for the email channel. A customer's name or a seller's rejection
 * reason goes into this, and both are user-supplied — rendering them raw would put stored
 * XSS into every recipient's inbox. Unknown placeholders are left visible rather than
 * silently blanked, so a template typo shows up as `{{oderNumber}}` instead of an empty gap
 * nobody notices.
 */
export function renderTemplate(template, variables = {}, { escape = true, raw = [] } = {}) {
  // Named exceptions rather than a blanket escape:false. A URL Mirwal itself built has to
  // survive intact — escaping "&" in it breaks the link — but everything around it is still
  // user-supplied text that must not reach an inbox unescaped.
  const rawKeys = new Set(raw)
  return String(template).replace(/\{\{\s*([\w.]+)\s*\}\}/g, (match, key) => {
    const value = variables[key]
    if (value === undefined || value === null) return match
    return escape && !rawKeys.has(key) ? escapeHtml(String(value)) : String(value)
  })
}

function escapeHtml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Which channels this deployment can actually use. Reported on the admin settings page. */
export function messagingCapabilities() {
  return {
    email: {
      configured: env.mail.enabled,
      host: env.mail.enabled ? env.mail.host : null,
      from: env.mail.from,
    },
    sms: {
      configured: env.sms.enabled,
      sender: env.sms.enabled ? env.sms.sender : null,
    },
  }
}
