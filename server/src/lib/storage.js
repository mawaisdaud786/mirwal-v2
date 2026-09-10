import { createHash, randomBytes } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, writeFile, unlink, stat } from 'node:fs/promises'
import path from 'node:path'
import { env } from '../config/env.js'
import { badRequest } from './errors.js'

/**
 * Local file storage for seller verification documents.
 *
 * This is the capability whose absence previously made document verification impossible to
 * build honestly. It writes to a directory outside any web root, and nothing here is ever
 * served statically — these files are CNICs, bank letters and tax certificates. The bytes
 * come back only through an authenticated endpoint that has already checked the caller owns
 * the document or is Mirwal staff.
 *
 * Three rules the rest of the system depends on:
 *
 *   1. The stored filename is generated, never derived from the upload. A name the client
 *      controls is how `../../etc/passwd` ends up written somewhere it should not be.
 *   2. The type is decided by inspecting the file's leading bytes, not by trusting the
 *      Content-Type header or the extension, both of which the client sets freely.
 *   3. Every read path re-resolves the final path and asserts it is still inside the upload
 *      root, so even a stored name that somehow contained traversal cannot escape.
 */

/** What a verification document may be. Anything else is refused. */
const ALLOWED = [
  { mime: 'application/pdf', ext: '.pdf', magic: [0x25, 0x50, 0x44, 0x46] },            // %PDF
  { mime: 'image/jpeg', ext: '.jpg', magic: [0xFF, 0xD8, 0xFF] },
  { mime: 'image/png', ext: '.png', magic: [0x89, 0x50, 0x4E, 0x47] },
  { mime: 'image/webp', ext: '.webp', magic: [0x52, 0x49, 0x46, 0x46] },                // RIFF….WEBP
]

/**
 * Identify a file from its own bytes.
 *
 * A client can claim any Content-Type; a PHP script renamed to `.jpg` with
 * `Content-Type: image/jpeg` would pass a header check and fail this one.
 */
function detectType(buffer) {
  for (const candidate of ALLOWED) {
    const matches = candidate.magic.every((byte, index) => buffer[index] === byte)
    if (!matches) continue
    // RIFF also fronts .wav and .avi; WEBP is confirmed by the format tag at offset 8.
    if (candidate.mime === 'image/webp' && buffer.subarray(8, 12).toString('ascii') !== 'WEBP') continue
    return candidate
  }
  return null
}

const uploadRoot = () => path.resolve(env.uploads.dir)

/** Resolve a stored name to an absolute path, refusing anything outside the upload root. */
function resolveStored(storedName) {
  const root = uploadRoot()
  const full = path.resolve(root, storedName)
  // path.resolve collapses `..`, so this comparison is what actually blocks traversal.
  if (full !== root && !full.startsWith(root + path.sep)) {
    throw badRequest('Invalid file reference.', 'INVALID_FILE_PATH')
  }
  return full
}

/**
 * Persist an uploaded buffer.
 *
 * @returns {Promise<{storedName:string, mimeType:string, size:number, checksum:string}>}
 */
export async function storeDocument(buffer, originalName) {
  if (!buffer?.length) throw badRequest('The file is empty.', 'EMPTY_FILE')
  if (buffer.length > env.uploads.maxBytes) {
    const mb = Math.round(env.uploads.maxBytes / (1024 * 1024))
    throw badRequest(`Files must be ${mb}MB or smaller.`, 'FILE_TOO_LARGE')
  }

  const detected = detectType(buffer)
  if (!detected) {
    throw badRequest('Upload a PDF, JPG, PNG or WebP. The file’s contents did not match any of those.', 'UNSUPPORTED_FILE_TYPE')
  }

  const root = uploadRoot()
  await mkdir(root, { recursive: true })

  // Random name + the extension for the type we actually detected — never the client's.
  const storedName = `${Date.now().toString(36)}-${randomBytes(12).toString('hex')}${detected.ext}`
  const full = resolveStored(storedName)
  await writeFile(full, buffer, { flag: 'wx' })

  return {
    storedName,
    mimeType: detected.mime,
    size: buffer.length,
    checksum: createHash('sha256').update(buffer).digest('hex'),
    // Sanitised for display only; it is never part of a path.
    safeOriginalName: String(originalName ?? 'document')
      .replace(/[^\w.\- ]+/g, '')
      .slice(0, 255) || 'document',
  }
}

/** A read stream for a stored document, for the authenticated download route. */
export async function readDocument(storedName) {
  const full = resolveStored(storedName)
  try {
    const info = await stat(full)
    return { stream: createReadStream(full), size: info.size }
  } catch {
    // The row exists but the file does not — worth reporting as missing rather than 500.
    throw badRequest('That file is no longer available on disk.', 'FILE_MISSING')
  }
}

/** Remove a stored document. A file that is already gone is not an error. */
export async function deleteDocument(storedName) {
  try {
    await unlink(resolveStored(storedName))
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
}

/** Reported on the admin settings page, so an operator can see where files land. */
export function storageInfo() {
  return {
    configured: true,
    driver: 'local-disk',
    directory: uploadRoot(),
    maxBytes: env.uploads.maxBytes,
    allowedTypes: ALLOWED.map((entry) => entry.mime),
  }
}
