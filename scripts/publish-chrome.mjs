import { compareChromeVersions, releasePackage } from './release-package.mjs'

const verifyOnly = process.argv.includes('--verify')
if (process.argv.slice(2).some(argument => argument !== '--verify'))
  throw new Error('Usage: node scripts/publish-chrome.mjs [--verify]')

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

const prepared = verifyOnly
  ? null
  : await releasePackage(process.env.RELEASE_TAG)
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
let status = await request(
  `https://chromewebstore.googleapis.com/v2/${item}:fetchStatus`,
  { headers },
)
if (status.itemId !== process.env.CWS_EXTENSION_ID)
  throw new Error('Chrome Web Store returned an unexpected extension ID.')
if (verifyOnly) {
  console.log(`Chrome Web Store access verified for ${status.itemId}.`)
  process.exit(0)
}

const { version, zip } = prepared
function checkPublishedVersion(current) {
  for (const channel of current.publishedItemRevisionStatus
    ?.distributionChannels || []) {
    if (compareChromeVersions(channel.crxVersion, version) >= 0)
      throw new Error(
        `Chrome Web Store already has version ${channel.crxVersion} or newer.`,
      )
  }
}
checkPublishedVersion(status)
const submitted = status.submittedItemRevisionStatus
if (
  submitted &&
  submitted.state !== 'PENDING_REVIEW' &&
  !['CANCELLED', 'REJECTED'].includes(submitted.state)
)
  throw new Error(
    `An existing Store submission is ${submitted.state || 'unknown'}; inspect it before uploading.`,
  )
if (status.submittedItemRevisionStatus?.state === 'PENDING_REVIEW') {
  const channels = status.submittedItemRevisionStatus.distributionChannels
  if (
    !channels?.length ||
    channels.some(
      channel => compareChromeVersions(channel.crxVersion, version) >= 0,
    )
  )
    throw new Error(
      'Pending review must have a known version strictly older than this release.',
    )
  await request(
    `https://chromewebstore.googleapis.com/v2/${item}:cancelSubmission`,
    {
      method: 'POST',
      headers,
    },
  )
  console.log(`Canceled the older pending review before submitting ${version}.`)
  status = await request(
    `https://chromewebstore.googleapis.com/v2/${item}:fetchStatus`,
    { headers },
  )
  if (
    status.itemId !== process.env.CWS_EXTENSION_ID ||
    (status.submittedItemRevisionStatus &&
      status.submittedItemRevisionStatus.state !== 'CANCELLED')
  )
    throw new Error(
      'Chrome Web Store review cancellation could not be confirmed.',
    )
  checkPublishedVersion(status)
}
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
if (upload.crxVersion && upload.crxVersion !== version) {
  throw new Error(
    `Uploaded version ${upload.crxVersion} does not match ${version}.`,
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
