import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { releaseFixture } from './release-fixture.mjs'

function verify(
  status = 200,
  itemId = 'test-extension',
  argument = '--verify',
) {
  const bootstrap = `
    import assert from 'node:assert/strict';
    let calls = 0;
    globalThis.fetch = async (url, options) => {
      calls += 1;
      if (calls === 1) {
        assert.equal(url, 'https://oauth2.googleapis.com/token');
        assert.equal(options.method, 'POST');
        assert.equal(options.body.get('grant_type'), 'refresh_token');
        return new Response(JSON.stringify({access_token: 'fake-token'}));
      }
      assert.equal(calls, 2, 'Verification must not make additional requests');
      assert.equal(url, 'https://chromewebstore.googleapis.com/v2/publishers/test-publisher/items/test-extension:fetchStatus');
      assert.equal(options.method || 'GET', 'GET', 'Verification must not mutate the Store');
      assert.equal(options.headers.authorization, 'Bearer fake-token');
      return new Response(JSON.stringify({itemId: ${JSON.stringify(itemId)}}), {status: ${status}});
    };
    process.on('exit', () => {
      if (process.exitCode === 0) assert.equal(calls, 2);
    });
  `
  return spawnSync(
    process.execPath,
    [
      '--import',
      `data:text/javascript,${encodeURIComponent(bootstrap)}`,
      'scripts/publish-chrome.mjs',
      argument,
    ],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        CWS_CLIENT_ID: 'fake-client',
        CWS_CLIENT_SECRET: 'fake-secret',
        CWS_REFRESH_TOKEN: 'fake-refresh',
        CWS_PUBLISHER_ID: 'test-publisher',
        CWS_EXTENSION_ID: 'test-extension',
      },
    },
  )
}

test('publication verification only refreshes credentials and reads the target item', () => {
  const result = verify()
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /access verified for test-extension/)
  assert.doesNotMatch(result.stdout, /fake-token|fake-secret|fake-refresh/)
})

test('publication verification fails when Store access is rejected', () => {
  const result = verify(403)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /403/)
})

test('publication verification refuses an unexpected item', () => {
  const result = verify(200, 'another-extension')
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /unexpected extension ID/)
})

test('unknown publication arguments fail instead of submitting a package', () => {
  const result = verify(200, 'test-extension', '--verfy')
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Usage:/)
})

function publish(root, steps, tag = 'v1.3.0') {
  const bootstrap = `
    import assert from 'node:assert/strict';
    import { readFileSync } from 'node:fs';
    const steps = ${JSON.stringify(steps)};
    let calls = 0;
    globalThis.fetch = async (url, options) => {
      const step = steps[calls++];
      assert.ok(step, 'Unexpected extra Store request');
      assert.ok(url.endsWith(step.endpoint), url);
      assert.equal(options.method || 'GET', step.method || 'GET');
      if (step.endpoint.endsWith(':upload')) {
        assert.deepEqual(options.body, readFileSync('artifacts/wikimasters-toolbox-1.3.0.zip'));
      }
      return new Response(JSON.stringify(step.body || {}), {status: step.status || 200});
    };
    process.on('exit', () => assert.equal(calls, steps.length));
  `
  return spawnSync(
    process.execPath,
    [
      '--import',
      `data:text/javascript,${encodeURIComponent(bootstrap)}`,
      'scripts/publish-chrome.mjs',
    ],
    {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        RELEASE_TAG: tag,
        CWS_CLIENT_ID: 'fake-client',
        CWS_CLIENT_SECRET: 'fake-secret',
        CWS_REFRESH_TOKEN: 'fake-refresh',
        CWS_PUBLISHER_ID: 'test-publisher',
        CWS_EXTENSION_ID: 'test-extension',
      },
    },
  )
}

const tokenStep = {
  endpoint: '/token',
  method: 'POST',
  body: { access_token: 'fake-token' },
}
const storeStatus = submitted => ({
  itemId: 'test-extension',
  publishedItemRevisionStatus: {
    state: 'PUBLISHED',
    distributionChannels: [{ crxVersion: '1.1.0' }],
  },
  ...(submitted ? { submittedItemRevisionStatus: submitted } : {}),
})
const statusStep = body => ({ endpoint: ':fetchStatus', body })
const pending = version => ({
  state: 'PENDING_REVIEW',
  distributionChannels: [{ crxVersion: version }],
})
const uploadStep = version => ({
  endpoint: ':upload',
  method: 'POST',
  body: { uploadState: 'SUCCEEDED', crxVersion: version },
})
const publishStep = {
  endpoint: ':publish',
  method: 'POST',
  body: { state: 'PENDING_REVIEW' },
}
const cancelStep = { endpoint: ':cancelSubmission', method: 'POST' }

test('publication sends the verified release ZIP and submits the expected version', async t => {
  const { root } = await releaseFixture(t)
  const result = publish(root, [
    tokenStep,
    statusStep(storeStatus()),
    uploadStep('1.3.0'),
    publishStep,
  ])
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /submission accepted: PENDING_REVIEW/)
})

test('an older review is canceled and confirmed before uploading the replacement', async t => {
  const { root } = await releaseFixture(t)
  const result = publish(root, [
    tokenStep,
    statusStep(storeStatus(pending('1.2.0'))),
    cancelStep,
    statusStep(storeStatus({ ...pending('1.2.0'), state: 'CANCELLED' })),
    uploadStep('1.3.0'),
    publishStep,
  ])
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /Canceled the older pending review/)
})

test('identical, newer and unknown pending reviews cannot be canceled', async t => {
  const { root } = await releaseFixture(t)
  for (const version of ['1.3.0', '1.3.0.0', '1.4.0', undefined]) {
    const result = publish(root, [
      tokenStep,
      statusStep(storeStatus(pending(version))),
    ])
    assert.notEqual(result.status, 0)
    assert.match(
      result.stderr,
      /Pending review|unknown Chrome Web Store version/,
    )
  }
})

test('a Store version at or above the target prevents upload and cancellation', async t => {
  const { root } = await releaseFixture(t)
  for (const version of ['1.3.0', '1.3.0.0', '1.10.0', '2.0.0']) {
    const status = storeStatus(pending('1.2.0'))
    status.publishedItemRevisionStatus.distributionChannels[0].crxVersion =
      version
    const result = publish(root, [tokenStep, statusStep(status)])
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /already has version/)
  }
})

test('an approved or unknown existing submission is preserved for inspection', async t => {
  const { root } = await releaseFixture(t)
  for (const state of ['STAGED', undefined]) {
    const result = publish(root, [
      tokenStep,
      statusStep(storeStatus({ ...pending('1.4.0'), state })),
    ])
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /inspect it before uploading/)
  }
})

test('failed cancellation and unconfirmed cancellation prevent upload without retrying', async t => {
  const { root } = await releaseFixture(t)
  const initial = [tokenStep, statusStep(storeStatus(pending('1.2.0')))]
  const rejected = publish(root, [...initial, { ...cancelStep, status: 429 }])
  assert.notEqual(rejected.status, 0)
  assert.match(rejected.stderr, /429/)
  const unconfirmed = publish(root, [
    ...initial,
    cancelStep,
    statusStep(storeStatus(pending('1.2.0'))),
  ])
  assert.notEqual(unconfirmed.status, 0)
  assert.match(unconfirmed.stderr, /cancellation could not be confirmed/)
})

test('an unexpected uploaded version is never submitted for review', async t => {
  const { root } = await releaseFixture(t)
  const result = publish(root, [
    tokenStep,
    statusStep(storeStatus()),
    uploadStep('1.2.0'),
  ])
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /does not match 1.3.0/)
})

test('a missing or invalid release package stops before any OAuth or Store write', async t => {
  const { root } = await releaseFixture(t)
  for (const tag of ['v1.4.0', 'main', 'v1.3.0-beta.1']) {
    const result = publish(root, [], tag)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /ENOENT|Expected a stable release tag/)
  }
})
