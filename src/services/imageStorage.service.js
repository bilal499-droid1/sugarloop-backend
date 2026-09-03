/**
 * The object store, behind one door.
 *
 * Every call that reaches S3 goes through this file. Nothing else in the API imports
 * `@aws-sdk/client-s3`, which is what makes the vendor question reversible: swapping to
 * Cloudinary means rewriting this module and nothing above it. `Product.images.publicId`
 * already means "the handle needed to delete this later" and is equally an S3 key or a
 * Cloudinary public_id, so the schema does not care either.
 *
 * **The bytes never touch this server.** The browser uploads straight to S3 against a
 * short-lived signed URL. That is not a preference — `app.js` caps request bodies at
 * 100kb, so a photo physically cannot be POSTed here, and raising that cap would mean
 * every upload occupying EC2 memory and bandwidth on an instance sized for JSON.
 *
 * Credentials are not read here or anywhere else. The AWS SDK's own chain finds them:
 * environment, shared config file, or — on EC2 — the instance role, which involves no
 * long-lived secret at all and is what production should use. The role needs
 * `s3:PutObject`, `s3:GetObject` and `s3:DeleteObject` on the bucket.
 */
import { randomBytes } from 'node:crypto'
import path from 'node:path'
import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { env } from '../config/env.js'
import { logger } from '../config/logger.js'
import { ApiError } from '../utils/ApiError.js'

/**
 * What a product photo is allowed to be.
 *
 * SVG is deliberately absent, and its absence is a security control rather than a
 * formatting preference. An SVG is an XML document that may carry `<script>`, and these
 * files are served from the CDN domain the storefront trusts — so an uploaded SVG is
 * stored XSS against every visitor. The migration script accepts SVG because it reads a
 * fixed set of files a developer already vetted; this endpoint accepts whatever an
 * account with a stolen admin session sends, which is not the same threat model.
 */
export const ALLOWED_IMAGE_TYPES = Object.freeze({
  'image/webp': '.webp',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/avif': '.avif',
})

/** 5 MB. Comfortably above a well-exported product photo, far below a camera master. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024

/**
 * How long a signed upload URL lives.
 *
 * Long enough for a slow connection to finish a 5 MB file, short enough that a URL
 * captured from a log or a browser history is useless by the time anyone reads it.
 */
const UPLOAD_URL_TTL_SECONDS = 300

/** Whether image hosting is configured at all. Without a bucket the catalogue still
 *  works and simply serves no images, which is the state described in `.env.example`. */
export function isConfigured() {
  return Boolean(env.S3_BUCKET)
}

let client = null

function s3() {
  if (!isConfigured()) {
    // 503 rather than 500: nothing is broken, the feature is switched off. The message
    // names the variable because the person who sees this is the one who can set it.
    throw new ApiError(
      503,
      'IMAGE_STORAGE_UNCONFIGURED',
      'Image uploads are not available — S3_BUCKET is not configured on this server'
    )
  }
  // Lazily, so importing this module has no side effect and the tests that never touch
  // S3 never construct a client or look for credentials.
  client ??= new S3Client({
    region: env.S3_REGION,
    /**
     * Without this, every presigned URL is born broken.
     *
     * Recent versions of the SDK compute a payload checksum by default and fold it into
     * the signature. At signing time there is no payload — the browser supplies it
     * later — so what gets signed is the CRC32 of nothing, `AAAAAA==`. S3 then compares
     * that against the checksum of the actual file and rejects every upload. The failure
     * is a flat 400 from S3 that says nothing about checksums, on a URL that looks
     * perfectly well-formed.
     *
     * WHEN_REQUIRED keeps checksums for the operations that genuinely mandate them and
     * leaves presigned PUTs alone.
     */
    requestChecksumCalculation: 'WHEN_REQUIRED',
  })
  return client
}

/**
 * Where an image is served from.
 *
 * The CloudFront domain when there is one, and the bucket's own endpoint otherwise —
 * which works, but is uncached and needs the objects to be publicly readable. Shared
 * with `scripts/uploadProductImages.js` deliberately: two copies of this rule would
 * agree right up until one of them was changed.
 */
export function publicUrlFor(key) {
  if (env.ASSET_BASE_URL) return `${env.ASSET_BASE_URL}/${key}`
  return `https://${env.S3_BUCKET}.s3.${env.S3_REGION}.amazonaws.com/${key}`
}

/** The prefix every object for one product lives under. */
function prefixFor(productId) {
  return `products/${productId}/`
}

/**
 * `Chocoholic Deluxe.JPEG` → `products/<id>/a3f9c1b8-chocoholic-deluxe.jpg`
 *
 * Three things are going on.
 *
 * The extension comes from the *content type*, not from the filename, so a file called
 * `photo.png` that is really a JPEG gets the key its bytes deserve.
 *
 * The name is slugged because uploaded filenames contain spaces, `#`, `?` and
 * inconsistent capitalisation — all legal in S3, all sources of URL-encoding bugs that
 * reproduce in exactly one browser.
 *
 * The random prefix is what makes the key unguessable and unique. Without it, uploading
 * two photos both exported as `front.jpg` would put the second on top of the first, and
 * a caller could name any key it liked and overwrite an existing product's photo.
 */
export function keyFor(productId, filename, contentType) {
  const extension = ALLOWED_IMAGE_TYPES[contentType] ?? '.bin'

  const base =
    path
      .basename(String(filename), path.extname(String(filename)))
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'image'

  return `${prefixFor(productId)}${randomBytes(4).toString('hex')}-${base}${extension}`
}

/**
 * Whether a key is one this product is allowed to claim.
 *
 * The upload is a round trip — we hand out a URL, the browser uses it, then it tells us
 * which key it wrote. That last step is client input, and without this check an admin
 * could attach any object in the bucket to any product, including one belonging to a
 * different product, and a later delete would then take out the other product's photo.
 */
export function keyBelongsTo(key, productId) {
  return typeof key === 'string' && key.startsWith(prefixFor(productId)) && !key.includes('..')
}

/**
 * A year, immutable. The random component in the key means the key changes whenever the
 * picture does, so a stale copy in a CDN or a browser is not a risk worth paying a
 * revalidation round trip for on every product tile.
 */
const CACHE_CONTROL = 'public, max-age=31536000, immutable'

/**
 * A short-lived URL the browser can PUT one file to.
 *
 * The returned `headers` are not advice — they are part of the signature, and the upload
 * fails with a 403 if the browser sends anything different. That is deliberate: signing
 * the content type stops a URL issued for a WebP being used to store an HTML document,
 * and signing the length stops a URL issued for a 200 KB photo being spent on a 2 GB
 * file. Both are the actual controls; the checks on attach are the second line.
 *
 * They are returned rather than documented because a header the client has to guess is a
 * header the client eventually gets wrong, and the symptom — a 403 from S3 on a URL this
 * server just issued — sends people looking at IAM policies for an afternoon.
 *
 *   const { uploadUrl, headers, key } = (await post(...)).data.upload
 *   await fetch(uploadUrl, { method: 'PUT', body: file, headers })
 *
 * `Content-Length` is deliberately absent from `headers`: the browser sets it from the
 * body and forbids scripts from setting it by hand. It is still signed, so sending a
 * file of a different size than was declared still fails.
 */
export async function createUploadUrl({ productId, filename, contentType, size }) {
  const key = keyFor(productId, filename, contentType)

  const uploadUrl = await getSignedUrl(
    s3(),
    new PutObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: key,
      ContentType: contentType,
      ContentLength: size,
      CacheControl: CACHE_CONTROL,
    }),
    {
      expiresIn: UPLOAD_URL_TTL_SECONDS,
      /**
       * Named explicitly because the presigner otherwise drops both.
       *
       * Left to itself it signs `content-length;host` and silently discards ContentType
       * and CacheControl — the upload then succeeds, and the object lands with whatever
       * type the client felt like sending and no cache header at all. Neither failure is
       * visible until a customer is served an uncached image of the wrong MIME type.
       */
      signableHeaders: new Set(['content-type', 'content-length', 'cache-control']),
    }
  )

  return {
    uploadUrl,
    key,
    url: publicUrlFor(key),
    expiresIn: UPLOAD_URL_TTL_SECONDS,
    headers: { 'Content-Type': contentType, 'Cache-Control': CACHE_CONTROL },
  }
}

/**
 * What is actually at that key, or null if nothing is.
 *
 * The existence check is the point. A client that never completed the PUT — or never
 * attempted it — would otherwise be able to attach a URL that 404s to a product, and the
 * catalogue would carry a broken image nobody could explain.
 */
export async function statObject(key) {
  try {
    const head = await s3().send(new HeadObjectCommand({ Bucket: env.S3_BUCKET, Key: key }))
    return { size: head.ContentLength ?? 0, contentType: head.ContentType ?? '' }
  } catch (err) {
    if (err?.$metadata?.statusCode === 404 || err.name === 'NotFound') return null
    throw err
  }
}

/**
 * Removes an object, and never throws.
 *
 * Called from two places that both want the same thing: a failed delete must not fail
 * the operation around it. Detaching an image is meant to take the photo off the site,
 * and reporting an error because the bucket was briefly unreachable would leave the
 * admin looking at a photo they were told they had removed. The orphaned object costs a
 * fraction of a cent; the confusing failure costs a support call. Same reasoning as
 * `audit.service` — log loudly, carry on.
 */
export async function deleteObject(key) {
  try {
    await s3().send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: key }))
    return true
  } catch (err) {
    logger.error({ err, key }, 'Failed to delete image object — it is now orphaned in S3')
    return false
  }
}
