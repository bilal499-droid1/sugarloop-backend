/**
 * Reads the storefront's `productsData.js` and works out which image files belong to
 * which product.
 *
 * This mapping exists only in the frontend bundle today: `productsData.js` imports 82
 * files and lists them per product, and `lib/catalogue.js` joins them onto the API's
 * catalogue by `legacyId`. That join is why a product an admin creates can never have a
 * photo — it has no legacyId and no local record. Moving the files into `Product.images`
 * removes the join, and this is the one-time reader that makes that possible.
 *
 * Parsed textually rather than imported. The file imports `.webp`, which only Vite can
 * resolve; Node would throw on the first import. Text is the honest way in, and the shape
 * it parses is checked hard enough that a change to that file fails loudly here rather
 * than silently mapping a donut to the wrong photograph.
 */
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'

/** `import chocoholic1 from '../../assets/category/chocoholic 1.webp'` */
const IMPORT = /import\s+(\w+)\s+from\s+'(\.\.\/\.\.\/assets\/[^']+)'/g

/** `{ id: 1, name: 'Chocoholic', ... images: [a, b, c], ... }` */
const PRODUCT = /\{\s*id:\s*(\d+)\s*,[^}]*?images:\s*\[([^\]]*)\]/g

/**
 * @param {string} productsDataPath  absolute path to the frontend's productsData.js
 * @returns {Promise<Array<{ legacyId: number, name: string, files: string[] }>>}
 */
export async function readProductImageMap(productsDataPath) {
  const source = await readFile(productsDataPath, 'utf8')
  // productsData.js lives at src/components/products/, and its imports are relative to it.
  const dir = path.dirname(productsDataPath)

  const fileByVariable = new Map()
  for (const [, variable, relative] of source.matchAll(IMPORT)) {
    fileByVariable.set(variable, path.resolve(dir, relative))
  }

  if (fileByVariable.size === 0) {
    throw new Error(`No asset imports found in ${productsDataPath} — has its shape changed?`)
  }

  const entries = []
  const missing = []

  for (const [block, id, imageList] of source.matchAll(PRODUCT)) {
    const variables = imageList
      .split(',')
      .map((token) => token.trim())
      .filter(Boolean)

    if (variables.length === 0) continue

    const files = []
    for (const variable of variables) {
      const file = fileByVariable.get(variable)

      // A name in an images array that was never imported means the regex has drifted
      // from the file. Collected rather than thrown on the first one, so a single run
      // reports everything that needs fixing.
      if (!file) {
        missing.push(`product ${id}: no import for '${variable}'`)
        continue
      }
      if (!existsSync(file)) {
        missing.push(`product ${id}: '${variable}' points at a missing file — ${file}`)
        continue
      }

      files.push(file)
    }

    const name = /name:\s*'([^']+)'/.exec(block)?.[1] ?? ''
    entries.push({ legacyId: Number(id), name, files })
  }

  if (missing.length > 0) {
    throw new Error(`productsData.js could not be read cleanly:\n  ${missing.join('\n  ')}`)
  }

  return entries
}
