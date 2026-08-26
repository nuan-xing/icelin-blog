import { createHash, createHmac } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const sourceDir = path.join(root, 'public', 'images');
const contentDir = path.join(root, 'src', 'content');
const FIVE_MB = 5 * 1024 * 1024;
const TARGET_BYTES = 5.8 * 1024 * 1024;
const MAX_EDGE = 5000;
const imageExtensions = new Set(['.avif', '.gif', '.jpeg', '.jpg', '.png', '.svg', '.webp']);
const args = new Set(process.argv.slice(2));
const dryRun = !args.has('--execute');
const rewriteContent = args.has('--rewrite-content');
const optimizeLarge = !args.has('--keep-large');

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`缺少环境变量 ${name}。`);
  return value;
}

function toPosix(value) {
  return value.split(path.sep).join('/');
}

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const fullPath = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(fullPath) : fullPath;
  }));
  return files.flat();
}

function localRelativePath(file) {
  return toPosix(path.relative(sourceDir, file));
}

function destinationKey(relativePath) {
  const normalized = relativePath.replace(/^\/+/, '');
  if (normalized.startsWith('topics/')) return normalized.slice('topics/'.length);
  return normalized;
}

function publicUrl(baseUrl, key) {
  return baseUrl.replace(/\/+$/, '') + '/' + key.split('/').map(encodeURIComponent).join('/');
}

function bytesToHex(value) {
  return Buffer.from(value).toString('hex');
}

function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex');
}

function awsEncode(value) {
  return encodeURIComponent(String(value))
    .replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

function canonicalPath(key) {
  return '/' + key.split('/').map(awsEncode).join('/');
}

function objectPath(config, key) {
  return canonicalPath(config.bucket + (key ? `/${key}` : ''));
}

function canonicalQuery(query = {}) {
  return Object.keys(query)
    .filter((key) => query[key] !== undefined && query[key] !== null && query[key] !== '')
    .map((key) => [awsEncode(key), awsEncode(query[key])])
    .sort((left, right) => left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : left[1] < right[1] ? -1 : left[1] > right[1] ? 1 : 0)
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
}

function timestamp() {
  const iso = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  return { date: iso.slice(0, 8), value: iso };
}

function hmac(key, value) {
  return createHmac('sha256', key).update(value).digest();
}

function signedHeaders(config, method, key, query, body, contentType, extra = {}) {
  const time = timestamp();
  const payloadHash = sha256Hex(body || Buffer.alloc(0));
  const headers = {
    'content-type': contentType || 'application/octet-stream',
    host: new URL(config.endpoint).host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': time.value,
    ...extra,
  };
  const names = Object.keys(headers).map((name) => name.toLowerCase()).sort();
  const canonical = names.map((name) => `${name}:${String(headers[name]).trim().replace(/\s+/g, ' ')}\n`).join('');
  const signed = names.join(';');
  const request = [
    method,
    objectPath(config, key),
    canonicalQuery(query),
    canonical,
    signed,
    payloadHash,
  ].join('\n');
  const scope = `${time.date}/auto/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', time.value, scope, sha256Hex(request)].join('\n');
  const dateKey = hmac(`AWS4${config.secretAccessKey}`, time.date);
  const regionKey = hmac(dateKey, 'auto');
  const serviceKey = hmac(regionKey, 's3');
  const signingKey = hmac(serviceKey, 'aws4_request');
  const signature = bytesToHex(hmac(signingKey, stringToSign));
  const requestHeaders = { ...headers };
  delete requestHeaders.host;
  requestHeaders.authorization = `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${scope}, SignedHeaders=${signed}, Signature=${signature}`;
  return requestHeaders;
}

async function request(config, method, key, query = {}, body = Buffer.alloc(0), contentType, extraHeaders = {}) {
  const queryString = canonicalQuery(query);
  const url = config.endpoint + objectPath(config, key) + (queryString ? `?${queryString}` : '');
  const response = await fetch(url, {
    method,
    headers: signedHeaders(config, method, key, query, body, contentType, extraHeaders),
    body: method === 'GET' || method === 'HEAD' ? undefined : body,
  });
  return response;
}

async function headObject(config, key) {
  const response = await request(config, 'HEAD', key);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`检查 R2 对象失败（${response.status}）：${key}`);
  return {
    bytes: Number(response.headers.get('content-length')) || 0,
    sourceHash: response.headers.get('x-amz-meta-source-sha256') || '',
  };
}

async function uploadObject(config, candidate) {
  const current = await headObject(config, candidate.key);
  if (current) {
    if (current.sourceHash === candidate.outputHash) {
      return { action: 'skip', reason: 'R2 中已有相同源文件', ...candidate };
    }
    throw new Error(`目标 R2 对象已存在且无法确认来源，已停止以避免覆盖：${candidate.key}`);
  }

  const response = await request(
    config,
    'PUT',
    candidate.key,
    {},
    candidate.body,
    candidate.contentType,
    { 'x-amz-meta-source-sha256': candidate.outputHash },
  );
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 240);
    throw new Error(`上传 R2 失败（${response.status}）：${candidate.key}${detail ? `：${detail}` : ''}`);
  }
  return { action: 'upload', ...candidate };
}

function contentTypeFor(fileName) {
  const extension = path.extname(fileName).toLowerCase();
  return {
    '.avif': 'image/avif',
    '.gif': 'image/gif',
    '.jpeg': 'image/jpeg',
    '.jpg': 'image/jpeg',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
  }[extension] || 'application/octet-stream';
}

async function optimizeLargeImage(buffer, relativePath) {
  if (!optimizeLarge || buffer.length <= FIVE_MB || /\.(gif|svg)$/i.test(relativePath)) {
    return { body: buffer, keySuffix: relativePath, optimized: false };
  }

  const metadata = await sharp(buffer).metadata();
  if (!metadata.width || !metadata.height) return { body: buffer, keySuffix: relativePath, optimized: false };
  const scale = Math.min(1, MAX_EDGE / Math.max(metadata.width, metadata.height));
  const qualities = [0.92, 0.90, 0.88, 0.86, 0.84, 0.82];
  let best = null;
  for (const quality of qualities) {
    const output = await sharp(buffer)
      .rotate()
      .resize({ width: Math.max(1, Math.round(metadata.width * scale)), height: Math.max(1, Math.round(metadata.height * scale)), fit: 'inside', withoutEnlargement: true })
      .webp({ quality: Math.round(quality * 100), effort: 5 })
      .toBuffer();
    best = output;
    if (output.length <= TARGET_BYTES) break;
  }

  if (!best || (best.length >= buffer.length && scale === 1)) {
    return { body: buffer, keySuffix: relativePath, optimized: false };
  }
  const parsed = path.posix.parse(relativePath);
  return { body: best, keySuffix: path.posix.join(parsed.dir, `${parsed.name}.webp`), optimized: true };
}

async function collectMarkdownFiles() {
  if (!existsSync(contentDir)) return [];
  return (await walk(contentDir)).filter((file) => path.extname(file).toLowerCase() === '.md');
}

async function reportAffectedContent(candidates) {
  const files = await collectMarkdownFiles();
  const localRefs = new Set(candidates.map((candidate) => `/images/${candidate.relativePath}`));
  const affected = [];
  for (const file of files) {
    const content = await readFile(file, 'utf8');
    const refs = [...localRefs].filter((ref) => content.includes(ref));
    if (refs.length) affected.push({ file: path.relative(root, file), refs });
  }
  return affected;
}

async function rewriteMarkdown(candidates, config) {
  const files = await collectMarkdownFiles();
  const replacements = new Map();
  for (const candidate of candidates) {
    replacements.set(`/images/${candidate.relativePath}`, publicUrl(config.publicBaseUrl, candidate.key));
    replacements.set(`images/${candidate.relativePath}`, publicUrl(config.publicBaseUrl, candidate.key));
  }
  let changed = 0;
  for (const file of files) {
    const before = await readFile(file, 'utf8');
    let after = before;
    for (const [from, to] of replacements) after = after.split(from).join(to);
    if (after !== before) {
      await writeFile(file, after);
      changed += 1;
    }
  }
  return changed;
}

function printUsage() {
  console.log('用法：node scripts/migrate-images-to-r2.mjs [--dry-run]');
  console.log('执行上传：node scripts/migrate-images-to-r2.mjs --execute --rewrite-content');
  console.log('大于 5MB 默认按高质量 WebP 优化；如需保留原文件，增加 --keep-large。');
}

if (args.has('--help')) {
  printUsage();
  process.exit(0);
}

if (!existsSync(sourceDir)) {
  console.log('未找到 public/images，没有需要迁移的本地图片。');
  process.exit(0);
}

const files = (await walk(sourceDir))
  .filter((file) => imageExtensions.has(path.extname(file).toLowerCase()))
  .sort((left, right) => left.localeCompare(right, 'en'));
const candidates = [];
for (const file of files) {
  const relativePath = localRelativePath(file);
  const input = await readFile(file);
  const prepared = await optimizeLargeImage(input, relativePath);
  const key = destinationKey(prepared.keySuffix);
  candidates.push({
    file,
    relativePath,
    key,
    body: prepared.body,
    contentType: contentTypeFor(key),
    originalBytes: input.length,
    outputBytes: prepared.body.length,
    outputHash: sha256Hex(prepared.body),
    optimized: prepared.optimized,
  });
}

const affected = await reportAffectedContent(candidates);
console.log(`${dryRun ? '[dry-run]' : '[execute]'} 找到 ${candidates.length} 张本地图片。`);
for (const candidate of candidates) {
  const decision = candidate.optimized
    ? `优化 ${candidate.originalBytes} B → ${candidate.outputBytes} B`
    : `保留 ${candidate.outputBytes} B`;
  console.log(`- ${candidate.relativePath} → ${candidate.key}（${decision}）`);
}
console.log(`受影响的 Markdown：${affected.length ? affected.map((item) => item.file).join('、') : '无'}`);

if (dryRun) {
  console.log('这是预览，没有上传、删除本地文件或修改 Markdown。增加 --execute 才会执行。');
  process.exit(0);
}

const config = {
  accountId: requiredEnv('R2_ACCOUNT_ID'),
  accessKeyId: requiredEnv('R2_ACCESS_KEY_ID'),
  secretAccessKey: requiredEnv('R2_SECRET_ACCESS_KEY'),
  bucket: requiredEnv('R2_BUCKET'),
  publicBaseUrl: requiredEnv('PUBLIC_R2_BASE_URL'),
};
config.endpoint = `https://${config.accountId}.r2.cloudflarestorage.com`;

const results = [];
for (const candidate of candidates) {
  results.push(await uploadObject(config, candidate));
  console.log(`${results.at(-1).action === 'skip' ? '跳过' : '上传'}：${candidate.key}`);
}

if (rewriteContent) {
  const changed = await rewriteMarkdown(candidates, config);
  console.log(`已更新 ${changed} 个 Markdown 文件中的本地图片引用。`);
} else {
  console.log('未修改 Markdown；如需在同一轮替换引用，请使用 --rewrite-content。');
}

console.log(`完成：${results.filter((result) => result.action === 'upload').length} 个上传，${results.filter((result) => result.action === 'skip').length} 个已存在。`);
