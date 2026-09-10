import { createHash, randomBytes } from 'node:crypto'
import { mkdir, writeFile, unlink } from 'node:fs/promises'
import path from 'node:path'
import { env } from '../config/env.js'
import { badRequest } from './errors.js'

/**
 * Public image storage.
 *
 * Deliberately a separate module, a separate directory and a separate table from
 * `lib/storage.js`, which holds seller verification documents.
 *
 * That separation is the whole point. Verification documents are CNICs, bank letters and tax
 * certificates: they live outside any web root and come back only through an authenticated
 * endpoint that has already checked the caller owns them or is staff. A product photograph is
 * the exact opposite — it has to be served to anonymous visitors on every page load. If both
 * lived under one root, one misconfigured static handler would put identity documents on the
 * public internet. They therefore share no directory, no table and no code path, and this file
 * duplicates a little of storage.js on purpose rather than parameterising one module with a
 * "public" flag that a future edit could set wrongly.
 *
 * Everything else follows the same three rules storage.js established, because they were
 * right there too:
 *
 *   1. the stored filename is generated, never derived from the upload;
 *   2. the type is decided from the file's own leading bytes, not the Content-Type header or
 *      the extension, both of which the client sets freely;
 *   3. every path is re-resolved and asserted to be inside the media root before use.
 *
 * PDFs are accepted by the document store and refused here: there is no legitimate reason for
 * a product image to be a PDF, and every additional type served from a public directory is
 * another parser exposed to anonymous input.
 */

const ALLOWED = [
  { mime: 'image/jpeg', ext: '.jpg', magic: [0xFF, 0xD8, 0xFF] },
  { mime: 'image/png', ext: '.png', magic: [0x89, 0x50, 0x4E, 0x47] },
  { mime: 'image/webp', ext: '.webp', magic: [0x52, 0x49, 0x46, 0x46] },
  { mime: 'image/gif', ext: '.gif', magic: [0x47, 0x49, 0x46, 0x38] },
]

/** The URL prefix these files are served from. Kept here so the route and the stored URL agree. */
export const MEDIA_URL_PREFIX = '/media'

function detectType(buffer) {
  for (const candidate of ALLOWED) {
    if (!candidate.magic.every((byte, index) => buffer[index] === byte)) continue
    // RIFF also fronts .wav and .avi; only the format tag at offset 8 confirms WebP.
    if (candidate.mime === 'image/webp' && buffer.subarray(8, 12).toString('ascii') !== 'WEBP') continue
    return candidate
  }
  return null
}

const mediaRoot = () => path.resolve(env.media.dir)

function resolveStored(storedName) {
  const root = mediaRoot()
  const full = path.resolve(root, storedName)
  // path.resolve collapses `..`, so this comparison is what actually blocks traversal.
  if (full !== root && !full.startsWith(root + path.sep)) {
    throw badRequest('Invalid file reference.', 'INVALID_FILE_PATH')
  }
  return full
}

/**
 * Read the pixel dimensions from the header bytes.
 *
 * Enough to reject a 20×20 image being passed off as a product photo, and to fill
 * `product_images.width/height` so the storefront can reserve layout space and avoid the
 * content shift that costs a page its Core Web Vitals score. Parsing only the header keeps
 * this cheap and avoids pulling an image library into the request path.
 *
 * Returns nulls rather than throwing when a format is not understood — unknown dimensions are
 * a missing nicety, not a reason to refuse an otherwise valid image.
 */
function readDimensions(buffer, mime) {
  try {
    if (mime === 'image/png') {
      return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
    }
    if (mime === 'image/gif') {
      return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) }
    }
    if (mime === 'image/webp') {
      // Only the simple lossy ("VP8 ") layout is read; VP8L and VP8X are left unmeasured
      // rather than guessed at.
      if (buffer.subarray(12, 16).toString('ascii') === 'VP8 ') {
        return { width: buffer.readUInt16LE(26) & 0x3FFF, height: buffer.readUInt16LE(28) & 0x3FFF }
      }
      return { width: null, height: null }
    }
    if (mime === 'image/jpeg') {
      // Walk the segment markers to the start-of-frame, which is where the size lives.
      let offset = 2
      while (offset < buffer.length - 9) {
        if (buffer[offset] !== 0xFF) { offset += 1; continue }
        const marker = buffer[offset + 1]
        // SOF0..SOF15, excluding the four that are not frame headers.
        if (marker >= 0xC0 && marker <= 0xCF && ![0xC4, 0xC8, 0xCC].includes(marker)) {
          return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) }
        }
        offset += 2 + buffer.readUInt16BE(offset + 2)
      }
    }
  } catch {
    // A truncated or unusual header is not worth failing an upload over.
  }
  return { width: null, height: null }
}

/**
 * Persist an uploaded image.
 *
 * @param {Buffer} buffer
 * @param {string} originalName
 * @param {{minWidth?:number, minHeight?:number}} [rules]
 */
export async function storeImage(buffer, originalName, { minWidth = 0, minHeight = 0 } = {}) {
  if (!buffer?.length) throw badRequest('The file is empty.', 'EMPTY_FILE')
  if (buffer.length > env.media.maxBytes) {
    const mb = Math.round(env.media.maxBytes / (1024 * 1024))
    throw badRequest(`Images must be ${mb}MB or smaller.`, 'FILE_TOO_LARGE')
  }

  const detected = detectType(buffer)
  if (!detected) {
    throw badRequest(
      'Upload a JPG, PNG, WebP or GIF image. The file’s contents did not match any of those.',
      'UNSUPPORTED_FILE_TYPE',
    )
  }

  const { width, height } = readDimensions(buffer, detected.mime)
  if (minWidth && width && width < minWidth) {
    throw badRequest(
      `That image is ${width}px wide. Product photos need to be at least ${minWidth}px so they stay sharp on a phone.`,
      'IMAGE_TOO_SMALL',
    )
  }
  if (minHeight && height && height < minHeight) {
    throw badRequest(`That image needs to be at least ${minHeight}px tall.`, 'IMAGE_TOO_SMALL')
  }

  const root = mediaRoot()
  await mkdir(root, { recursive: true })

  const storedName = `${Date.now().toString(36)}-${randomBytes(12).toString('hex')}${detected.ext}`
  // `wx` fails rather than overwriting, so a name collision can never silently replace
  // someone else's image.
  await writeFile(resolveStored(storedName), buffer, { flag: 'wx' })

  return {
    storedName,
    url: `${MEDIA_URL_PREFIX}/${storedName}`,
    mimeType: detected.mime,
    size: buffer.length,
    width,
    height,
    checksum: createHash('sha256').update(buffer).digest('hex'),
    safeOriginalName: String(originalName ?? 'image')
      .replace(/[^\w.\- ]+/g, '')
      .slice(0, 255) || 'image',
  }
}

/** Remove a stored image. A file that is already gone is not an error. */
export async function deleteImage(storedName) {
  try {
    await unlink(resolveStored(storedName))
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
}

/** Absolute path for the static handler to serve from. */
export const mediaDirectory = () => mediaRoot()

export function mediaInfo() {
  return {
    directory: mediaRoot(),
    urlPrefix: MEDIA_URL_PREFIX,
    maxBytes: env.media.maxBytes,
    allowedTypes: ALLOWED.map((entry) => entry.mime),
  }
}
