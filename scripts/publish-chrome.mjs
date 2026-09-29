import { readFile } from 'node:fs/promises'

const required = [
  'CWS_CLIENT_ID',
  'CWS_CLIENT_SECRET',
  'CWS_REFRESH_TOKEN',
  'CWS_PUBLISHER_ID',
  'CWS_EXTENSION_ID',
]
const missing = required.filter(key => !process.env[key])
if (missing.length)
  throw new Error(`Missing Chrome Web Store credentials: ${missing.join(', ')}`)

const manifest = JSON.parse(
  await readFile(new URL('../dist/manifest.json', import.meta.url), 'utf8'),
)
const zip = await readFile(
  new URL(
    `../artifacts/wikimasters-toolbox-${manifest.version}.zip`,
    import.meta.url,
  ),
)
const publisher = encodeURIComponent(process.env.CWS_PUBLISHER_ID)
const extension = encodeURIComponent(process.env.CWS_EXTENSION_ID)
const item = `publishers/${publisher}/items/${extension}`

async function request(url, options) {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(60_000),
  })
  const body = await response.text()
  let json
  try {
    json = JSON.parse(body)
  } catch {
    json = { message: body }
  }
  if (!response.ok)
    throw new Error(
      `${response.status} ${response.statusText}: ${JSON.stringify(json)}`,
    )
  return json
}

const token = await request('https://oauth2.googleapis.com/token', {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    client_id: process.env.CWS_CLIENT_ID,
    client_secret: process.env.CWS_CLIENT_SECRET,
    refresh_token: process.env.CWS_REFRESH_TOKEN,
    grant_type: 'refresh_token',
  }),
})
if (!token.access_token)
  throw new Error('OAuth token response did not include an access token.')

const headers = { authorization: `Bearer ${token.access_token}` }
const upload = await request(
  `https://chromewebstore.googleapis.com/upload/v2/${item}:upload`,
  {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/zip' },
    body: zip,
  },
)
let state = upload.uploadState
for (let attempt = 0; state === 'IN_PROGRESS' && attempt < 12; attempt += 1) {
  await new Promise(resolve => setTimeout(resolve, 5_000))
  const status = await request(
    `https://chromewebstore.googleapis.com/v2/${item}:fetchStatus`,
    { headers },
  )
  state = status.lastAsyncUploadState
}
if (state !== 'SUCCEEDED')
  throw new Error(`Chrome Web Store upload did not succeed: ${state}`)
if (upload.crxVersion && upload.crxVersion !== manifest.version) {
  throw new Error(
    `Uploaded version ${upload.crxVersion} does not match ${manifest.version}.`,
  )
}

const result = await request(
  `https://chromewebstore.googleapis.com/v2/${item}:publish`,
  {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: '{}',
  },
)
console.log(
  `Chrome Web Store submission accepted: ${result.state || 'state unavailable'}`,
)
