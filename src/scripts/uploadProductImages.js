/**
 * Moves the storefront's bundled product photos into S3 and records them on the products.
 *
 *   npm run images:upload -- --dry-run   show exactly what would happen, touch nothing
 *   npm run images:upload                upload, then write Product.images
 *
 * Why this exists: `lib/catalogue.js` takes every photo from the frontend bundle and
 * joins it to the API's catalogue by `legacyId`. That join is invisible until somebody
 * adds a product through the admin console — it has no legacyId, so it can never have a
 * picture. Once the images are on the products themselves the join can go, and a new
 * product gets a photo the same way it gets a price.
 *
 * Safe to re-run. Keys are derived from the product and the file, so a second run
 * overwrites the same objects rather than accumulating copies, and the resulting
 * `images` array is rebuilt from scratch each time rather than appended to.
 *
 * Deliberately NOT part of the API and not wired into the seed: it reads a path in
 * another repository, which is true exactly once, during this migration.
 */
import path from 'node:path'
import { readFile } from 'node:fs/promises'
import mongoose from 'mongoose'
import { S3Client, PutObjectCommand, HeadBucketCommand } from '@aws-sdk/client-s3'
import { env } from '../config/env.js'
import { Product } from '../models/Product.js'
import { publicUrlFor } from '../services/imageStorage.service.js'
import { readProductImageMap } from './productImageMap.js'

const DRY_RUN = process.argv.includes('--dry-run')

/**
 * Where the storefront lives. Overridable because it is a sibling checkout, and nothing
 * guarantees it sits next to this one on every machine.
 */
const FRONTEND =
  process.env.FRONTEND_PATH ?? path.resolve(process.cwd(), '..', 'roots-international')

const PRODUCTS_DATA = path.join(FRONTEND, 'src', 'components', 'products', 'productsData.js')

const CONTENT_TYPE = {
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
}

/**
 * `category/chocoholic 1.webp` → `products/1/1-chocoholic-1.webp`
 *
 * Prefixed by product so a bucket listing is readable by a human, and slugged because the
 * source filenames contain spaces and inconsistent capitalisation — both legal in S3 and
 * both a source of URL-encoding bugs that only show up in one browser.
 */
function keyFor(legacyId, file, index) {
  const extension = path.extname(file).toLowerCase()
  const base = path
    .basename(file, path.extname(file))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return `products/${legacyId}/${index + 1}-${base}${extension}`
}

// `publicUrlFor` is imported rather than repeated. Two copies of the rule that turns a
// key into a URL would agree right up until one of them was changed, and the symptom
// would be images that work everywhere except the ones this script wrote.

async function main() {
  const entries = await readProductImageMap(PRODUCTS_DATA)
  const fileCount = entries.reduce((n, e) => n + e.files.length, 0)

  console.log(`\nRead ${PRODUCTS_DATA}`)
  console.log(`  ${entries.length} products carry ${fileCount} image files\n`)

  if (!DRY_RUN && !env.S3_BUCKET) {
    console.error('S3_BUCKET is not set. Add it to .env, or run with --dry-run.\n')
    process.exit(1)
  }

  let s3 = null
  if (!DRY_RUN) {
    s3 = new S3Client({ region: env.S3_REGION })

    // Fail here, before touching the database, if the bucket or the credentials are
    // wrong. The alternative is finding out halfway through with some products updated
    // and some not.
    try {
      await s3.send(new HeadBucketCommand({ Bucket: env.S3_BUCKET }))
    } catch (err) {
      console.error(
        `\nCannot reach bucket '${env.S3_BUCKET}' in ${env.S3_REGION}: ${err.name}\n` +
          '  - NotFound: the bucket name or region is wrong\n' +
          '  - Forbidden / AccessDenied: the credentials lack s3:ListBucket on it\n' +
          '  - CredentialsProviderError: the SDK found no credentials at all\n'
      )
      process.exit(1)
    }

    await mongoose.connect(env.MONGODB_URI)
  }

  let uploaded = 0
  let updated = 0
  const unmatched = []

  for (const entry of entries) {
    // The catalogue is joined on legacyId, the same key the frontend uses.
    const product = DRY_RUN ? null : await Product.findOne({ legacyId: entry.legacyId })

    if (!DRY_RUN && !product) {
      unmatched.push(`${entry.legacyId} (${entry.name})`)
      continue
    }

    const images = []

    for (const [index, file] of entry.files.entries()) {
      const key = keyFor(entry.legacyId, file, index)

      if (DRY_RUN) {
        console.log(`  ${String(entry.legacyId).padStart(3)}  ${key}`)
      } else {
        const body = await readFile(file)
        await s3.send(
          new PutObjectCommand({
            Bucket: env.S3_BUCKET,
            Key: key,
            Body: body,
            ContentType: CONTENT_TYPE[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
            // A year, immutable: the key changes when the picture does, so a stale copy
            // in a CDN or a browser is not a risk worth revalidating for.
            CacheControl: 'public, max-age=31536000, immutable',
          })
        )
        uploaded += 1
      }

      images.push({
        url: publicUrlFor(key),
        publicId: key,
        // The product name is a better alt text than the filename, and the only one
        // available without a human writing 82 of them.
        alt: entry.name,
        order: index,
      })
    }

    if (!DRY_RUN) {
      // Replaced, not appended — so re-running converges rather than duplicating.
      product.images = images
      await product.save()
      updated += 1
      console.log(`  ${String(entry.legacyId).padStart(3)}  ${entry.name.padEnd(26)} ${images.length} image(s)`)
    }
  }

  console.log('')
  if (DRY_RUN) {
    console.log(`Dry run. ${fileCount} files would be uploaded under ${entries.length} products.`)
    console.log(`Base URL would be: ${env.ASSET_BASE_URL ?? '(bucket endpoint — set ASSET_BASE_URL)'}\n`)
  } else {
    console.log(`Uploaded ${uploaded} files; updated ${updated} products.`)
    if (unmatched.length > 0) {
      console.log(`\nNo product in the database for legacyId: ${unmatched.join(', ')}`)
      console.log('These are in the storefront bundle but not the API catalogue.')
    }
    console.log('')
    await mongoose.disconnect()
  }
}

await main()
