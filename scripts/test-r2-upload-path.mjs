import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

const source = await readFile(new URL('../public/admin/r2-media.js', import.meta.url), 'utf8');
const routingSource = await readFile(new URL('../public/admin/r2-routing.js', import.meta.url), 'utf8');
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
  window: { crypto: webcrypto, location: { hash: '' } },
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
vm.runInNewContext(routingSource, context);

const media = context.window.IcelinR2Media;
const routing = context.window.IcelinR2Routing;
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

for (const scenario of [
  {
    hash: '#/collections/topics/entries/qinglong-lake',
    routeOptions: { mode: 'entry' },
    fileName: 'test-qinglong.webp',
    expectedFolder: 'qinglong-lake',
  },
  {
    hash: '#/collections/topics/entries/astronomy',
    routeOptions: { mode: 'entry' },
    fileName: 'test-astronomy.webp',
    expectedFolder: 'astronomy',
  },
  {
    hash: '#/collections/topics/new',
    routeOptions: { mode: 'entry', entrySlugs: ['example-topic'] },
    fileName: 'test.webp',
    expectedFolder: 'example-topic',
  },
  {
    hash: '#/collections/photos/new',
    routeOptions: { configuredFolder: 'photos' },
    fileName: 'test-photo.webp',
    expectedFolder: 'photos',
  },
]) {
  context.window.location.hash = scenario.hash;
  const folder = routing.resolveFolder({ ...scenario.routeOptions, hash: scenario.hash }).folder;
  assert.equal(folder, scenario.expectedFolder);
  const result = await media.uploadPrepared(
    { file: makeFile(scenario.fileName), optimized: false, originalBytes: 3 },
    folder,
    { config, secret: 'test-secret' },
  );
  assert.equal(result.key, `${scenario.expectedFolder}/${scenario.fileName}`);
  assert.equal(result.url, `https://img.example.com/${scenario.expectedFolder}/${scenario.fileName}`);
}

const putCalls = calls.filter(({ options }) => options.method === 'PUT');
assert.equal(putCalls.length, 4);
for (const { url, options } of putCalls) {
  assert.match(url, /\/icelin-blog-media\/(qinglong-lake|astronomy|example-topic|photos)\//);
  assert.ok(options.headers.authorization);
  assert.equal(Object.keys(options.headers).some((key) => key.toLowerCase() === 'host'), false);
}
assert.equal(calls.some(({ options }) => (options.method === 'GET' || options.method === 'HEAD') && options.body !== undefined), false);
console.log('R2 upload path checks passed: topic slugs, new topics, and photos folders.');
