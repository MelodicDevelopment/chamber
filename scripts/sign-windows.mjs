// Windows code-signing hook, invoked by Tauri's bundler via
// `bundle.windows.signCommand` in src-tauri/tauri.conf.json (Tauri substitutes
// the file needing a signature for %1 and passes it as this script's only arg).
//
// Cross-platform Authenticode signing via Azure Trusted Signing (jsign talks
// directly to the Trusted Signing REST API — no signtool.exe, no cert file on
// disk). Same signing account/profile convention as Envy, Coax, and Tapedeck.
//
// Required env vars (set as GitHub Actions secrets for CI release builds; see
// .env.example for local testing):
//   AZURE_TENANT_ID
//   AZURE_CLIENT_ID
//   AZURE_CLIENT_SECRET
//   TRUSTED_SIGNING_ENDPOINT      e.g. https://eus.codesigning.azure.net
//   TRUSTED_SIGNING_ACCOUNT       Artifact Signing account name
//   TRUSTED_SIGNING_PROFILE       Certificate profile name
//
// The service principal must have the "Artifact Signing Certificate Profile
// Signer" role on the signing account (or certificate profile) resource.
//
// On the CI Windows runner, set JSIGN_JAR to a downloaded jsign jar path and
// this script runs it via `java -jar` (no separate jsign install needed).
// For local testing where `jsign` is already on PATH (e.g. `brew install
// jsign` on macOS), leave JSIGN_JAR unset.

import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

loadDotEnvLocal()

const REQUIRED = [
  'AZURE_TENANT_ID',
  'AZURE_CLIENT_ID',
  'AZURE_CLIENT_SECRET',
  'TRUSTED_SIGNING_ENDPOINT',
  'TRUSTED_SIGNING_ACCOUNT',
  'TRUSTED_SIGNING_PROFILE',
]

const file = process.argv[2]
if (!file) {
  throw new Error('sign-windows: expected the file path as the first argument (Tauri passes %1)')
}

// Local test builds only: skip signing entirely. NEVER set this for a
// release — published artifacts must be signed, and the missing-env guard
// below enforces that by default.
if (process.env.SKIP_WIN_SIGN === '1' || process.env.SKIP_WIN_SIGN === 'true') {
  console.log(`  • signing(win)     SKIPPED (SKIP_WIN_SIGN set) file=${file}`)
  process.exit(0)
}

const missing = REQUIRED.filter((k) => !process.env[k] || !process.env[k].trim())
if (missing.length > 0) {
  throw new Error(
    `sign-windows: missing required env var(s): ${missing.join(', ')}\n` +
      '  Set them as GitHub Actions secrets (see .env.example for the full list).',
  )
}

const endpoint = process.env.TRUSTED_SIGNING_ENDPOINT.trim()
const account = process.env.TRUSTED_SIGNING_ACCOUNT.trim()
const profile = process.env.TRUSTED_SIGNING_PROFILE.trim()

const token = await getAzureAccessToken()

const jsignArgs = [
  '--storetype', 'TRUSTEDSIGNING',
  '--keystore', endpoint,
  '--storepass', token,
  '--alias', `${account}/${profile}`,
  // Microsoft's TSA is an RFC 3161 server; jsign defaults to authenticode
  // mode and chokes parsing the response ("Malformed content") without this.
  '--tsmode', 'RFC3161',
  '--tsaurl', 'http://timestamp.acs.microsoft.com',
  '--replace',
  file,
]

console.log(`  • signing(win)     file=${file}`)
const start = Date.now()

if (process.env.JSIGN_JAR) {
  await run('java', ['-jar', process.env.JSIGN_JAR, ...jsignArgs])
} else {
  await run('jsign', jsignArgs)
}

const seconds = Math.round((Date.now() - start) / 1000)
console.log(`  • signed(win)      durationSeconds=${seconds}`)

// Acquire an Azure AD access token for the Trusted/Artifact Signing service
// via the OAuth2 client-credentials flow. The resulting bearer token is what
// jsign expects as --storepass for the TRUSTEDSIGNING storetype.
async function getAzureAccessToken() {
  const tenant = process.env.AZURE_TENANT_ID.trim()
  const clientId = process.env.AZURE_CLIENT_ID.trim()
  const clientSecret = process.env.AZURE_CLIENT_SECRET.trim()

  const url = `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
    scope: 'https://codesigning.azure.net/.default',
  })

  let res
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })
  } catch (err) {
    throw new Error(`sign-windows: network error acquiring Azure access token: ${err.message}`)
  }

  const text = await res.text()
  if (!res.ok) {
    throw new Error(
      `sign-windows: failed to acquire Azure access token (HTTP ${res.status}).\n` +
        '  Check AZURE_TENANT_ID / AZURE_CLIENT_ID / AZURE_CLIENT_SECRET.\n' +
        `  Response: ${text}`,
    )
  }

  let json
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error(`sign-windows: token endpoint returned non-JSON: ${text}`)
  }
  if (!json.access_token) {
    throw new Error('sign-windows: token response missing access_token')
  }
  return json.access_token
}

function run(cmd, args) {
  return new Promise((resolveP, rejectP) => {
    const child = spawn(cmd, args, {
      stdio: ['ignore', 'inherit', 'inherit'],
      env: process.env,
    })
    child.on('error', (err) => {
      if (err.code === 'ENOENT') {
        rejectP(
          new Error(
            `sign-windows: \`${cmd}\` not found in PATH.\n` +
              '  CI: set JSIGN_JAR to a downloaded jsign jar path.\n' +
              '  Local: brew install jsign (macOS) or see https://ebourg.github.io/jsign/',
          ),
        )
      } else {
        rejectP(err)
      }
    })
    child.on('exit', (code) => {
      if (code === 0) resolveP()
      else rejectP(new Error(`sign-windows: \`${cmd}\` exited ${code}`))
    })
  })
}

// .env.local loader — Tauri invokes signCommand without sourcing dotenv, so
// do it here. process.env always wins (CI provides its own creds).
function loadDotEnvLocal() {
  let dir = __dirname
  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, '.env.local')
    if (existsSync(candidate)) {
      const text = readFileSync(candidate, 'utf8')
      for (const raw of text.split('\n')) {
        const line = raw.trim()
        if (line === '' || line.startsWith('#')) continue
        const eq = line.indexOf('=')
        if (eq <= 0) continue
        const key = line.slice(0, eq).trim()
        let value = line.slice(eq + 1).trim()
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1)
        }
        if (process.env[key] === undefined) process.env[key] = value
      }
      return
    }
    const parent = dirname(dir)
    if (parent === dir) return
    dir = parent
  }
}
