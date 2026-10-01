import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'

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
