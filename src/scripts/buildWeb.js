/**
 * Builds the frontend and copies it into `public/`, which is what `app.js` serves.
 *
 * The two halves of this site live in separate repositories — this one and
 * `roots-international` — so something has to carry the build across, and doing it by
 * hand is the step that goes wrong. Vite fingerprints every file it emits
 * (`index-KxS2bPZA.js`), so a hand-copy leaves last week's hashes sitting in `public/`
 * forever, and copying "the index, the JS and the CSS" ships a shop with no photographs:
 * the build is one HTML file and around a hundred assets, nearly all of them images.
 *
 * So: wipe `public/` and copy the whole `dist/` every time. It is the only version of
 * this that cannot half-work.
 *
 *   npm run build:web
 *   FRONTEND_DIR=/path/to/roots-international npm run build:web
 *
 * `public/` is gitignored. The build is a deploy artefact, and this repository is public
 * — 5.7 MB of binaries per rebuild does not belong in its history.
 */
import { existsSync, rmSync, cpSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

/**
 * Defaults to a sibling checkout, which is how these two repositories are normally laid
 * out. `FRONTEND_DIR` is the escape hatch for a build machine that arranges them
 * differently.
 */
const frontendDir = path.resolve(
  process.env.FRONTEND_DIR ?? path.join(backendRoot, '..', 'roots-international')
)
const distDir = path.join(frontendDir, 'dist')
const publicDir = path.join(backendRoot, 'public')

/**
 * Vite inlines `VITE_*` at build time, so this is baked into the bundle and changing it
 * needs a rebuild, not a restart.
 *
 * A relative path, because the API is now mounted on this same origin. That is also what
 * makes CORS a non-issue for the shop — though `CORS_ORIGINS` must still be set, since
 * `config/env.js` refuses to boot on an empty one outside development.
 */
const apiBaseUrl = process.env.VITE_API_BASE_URL ?? '/api/v1'

function fail(message) {
  console.error(`\n${message}\n`)
  process.exit(1)
}

if (!existsSync(frontendDir)) {
  fail(
    `Frontend not found at ${frontendDir}\n` +
      'Set FRONTEND_DIR to the roots-international checkout, or put it beside this repo.'
  )
}

if (!existsSync(path.join(frontendDir, 'package.json'))) {
  fail(`${frontendDir} has no package.json — that is not the frontend checkout.`)
}

console.log(`Building  ${frontendDir}`)
console.log(`API base  ${apiBaseUrl}`)

// `shell: true` so this works on Windows, where npm is a .cmd and Node will not execute
// one directly. The arguments are ours, not anyone's input.
const build = spawnSync('npm', ['run', 'build'], {
  cwd: frontendDir,
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, VITE_API_BASE_URL: apiBaseUrl },
})

if (build.status !== 0) fail('Frontend build failed — nothing was copied.')
if (!existsSync(path.join(distDir, 'index.html'))) {
  fail(`Build reported success but ${distDir} has no index.html.`)
}

// Wiped rather than merged. A merge keeps every asset every previous build ever emitted,
// and since the names are content-hashed nothing ever overwrites anything — the
// directory only grows, and a stale bundle stays reachable by anyone holding its URL.
rmSync(publicDir, { recursive: true, force: true })
cpSync(distDir, publicDir, { recursive: true })

let files = 0
let bytes = 0
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full)
    else {
      files += 1
      bytes += statSync(full).size
    }
  }
}
walk(publicDir)

console.log(`\nCopied ${files} files (${(bytes / 1024 / 1024).toFixed(1)} MB) to ${publicDir}`)
console.log('Restart the API to pick it up — the build is detected once, at boot.\n')
