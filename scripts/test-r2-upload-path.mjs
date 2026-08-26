import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

const source = await readFile(new URL('../public/admin/r2-media.js', import.meta.url), 'utf8');
const calls = [];

class ResponseMock {
  constructor(body = '', status = 200) {
    this.body = body;
    this.status = status;
    this.ok = status >= 200 && status < 300;
    this.headers = { get: () => null };
  }

  async text() {
    return this.body;
  }
}

class DomParserMock {
  parseFromString() {
    return { getElementsByTagName: () => [] };
  }
}

const fetchMock = async (url, options = {}) => {
  calls.push({ url, options });
  return new ResponseMock(options.method === 'GET' ? '<ListBucketResult />' : '');
};

const context = {
  window: { crypto: webcrypto },
  crypto: webcrypto,
  fetch: fetchMock,
  DOMParser: DomParserMock,
  TextEncoder,
  URL,
  Uint8Array,
  ArrayBuffer,
  Set,
  Date,
  Math,
  encodeURIComponent,
  console,
};
vm.runInNewContext(source, context);

const media = context.window.IcelinR2Media;
const config = {
  endpoint: 'https://acct.r2.cloudflarestorage.com',
  bucket: 'icelin-blog-media',
  accessKeyId: 'test-access-key',
  publicUrl: 'https://img.example.com',
};

const makeFile = (name) => ({
  name,
  type: 'image/webp',
  size: 1024,
  arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
});

for (const folder of ['qinglong-lake', 'astronomy']) {
  const result = await media.uploadPrepared(
    { file: makeFile('test.webp'), optimized: false, originalBytes: 3 },
    folder,
    { config, secret: 'test-secret' },
  );
  assert.equal(result.key, `${folder}/test.webp`);
  assert.equal(result.url, `https://img.example.com/${folder}/test.webp`);
}

const putCalls = calls.filter(({ options }) => options.method === 'PUT');
assert.equal(putCalls.length, 2);
for (const { url, options } of putCalls) {
  assert.match(url, /\/icelin-blog-media\/(qinglong-lake|astronomy)\/test\.webp$/);
  assert.ok(options.headers.authorization);
  assert.equal(Object.keys(options.headers).some((key) => key.toLowerCase() === 'host'), false);
}
assert.equal(calls.some(({ options }) => (options.method === 'GET' || options.method === 'HEAD') && options.body !== undefined), false);
console.log('R2 upload path checks passed: qinglong-lake/ and astronomy/');
