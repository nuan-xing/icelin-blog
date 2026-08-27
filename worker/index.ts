/// <reference types="@cloudflare/workers-types" />

export interface Env {
  DB: D1Database;
  MEDIA: R2Bucket;
  MEDIA_PUBLIC_URL: string;
  ALLOWED_ORIGIN: string;
  SITE_URL: string;
  ADMIN_PASSWORD: string;
  ADMIN_SESSION_SECRET: string;
}

type JsonRecord = Record<string, unknown>;
type Usage = { collection: string; slug: string; title: string; field: string };

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const jsonHeaders = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };

function trimSlashes(value: string) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function cleanFolder(value: unknown) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/\\/g, '/')
    .split('/')
    .filter((part) => part && part !== '.' && part !== '..')
    .join('-')
    .replace(/[^\p{L}\p{N}._~-]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 96);
}

function cleanObjectKey(value: unknown) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/\\/g, '/')
    .split('/')
    .filter((part) => part && part !== '.' && part !== '..')
    .map((part) => part.replace(/[\u0000-\u001f\u007f]/g, '').trim())
    .filter(Boolean)
    .join('/')
    .slice(0, 512);
}

function cleanSlug(value: unknown) {
  return cleanFolder(value).replace(/\./g, '-');
}

function isoDate(value: unknown) {
  const parsed = new Date(String(value || ''));
  return Number.isNaN(parsed.valueOf()) ? new Date().toISOString() : parsed.toISOString();
}

function text(value: unknown, limit = 12000) {
  return String(value ?? '').trim().slice(0, limit);
}

function bool(value: unknown) {
  return value === true || value === 1 || value === '1' || value === 'true';
}

function responseHeaders(request: Request, env: Env, extra?: HeadersInit) {
  const headers = new Headers(extra);
  Object.entries(corsHeaders(request, env)).forEach(([name, value]) => headers.set(name, value));
  return headers;
}

function json(request: Request, env: Env, body: unknown, init: ResponseInit = {}) {
  const headers = responseHeaders(request, env, jsonHeaders);
  // Endpoint-specific headers (notably the short public cache policy) must
  // override the safe no-store default used by admin and error responses.
  new Headers(init.headers).forEach((value, name) => headers.set(name, value));
  return new Response(JSON.stringify(body), {
    ...init,
    headers,
  });
}

function empty(request: Request, env: Env, init: ResponseInit = {}) {
  return new Response(null, { ...init, headers: responseHeaders(request, env, init.headers) });
}

function corsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get('origin');
  if (!origin || origin !== env.ALLOWED_ORIGIN) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'access-control-allow-headers': 'Authorization, Content-Type',
    'access-control-max-age': '86400',
    vary: 'Origin',
  };
}

function originIsAllowed(request: Request, env: Env) {
  const origin = request.headers.get('origin');
  return !origin || origin === env.ALLOWED_ORIGIN;
}

function error(request: Request, env: Env, status: number, message: string, details?: unknown) {
  return json(request, env, { error: message, ...(details === undefined ? {} : { details }) }, { status });
}

async function readJson(request: Request): Promise<JsonRecord> {
  const value = await request.json();
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('请求内容必须是 JSON 对象。');
  return value as JsonRecord;
}

function base64Url(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(value: string) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((value.length + 3) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function sign(value: string, secret: string) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(value));
  return base64Url(new Uint8Array(signature));
}

async function sessionToken(env: Env) {
  const payload = base64Url(encoder.encode(JSON.stringify({ exp: Date.now() + 1000 * 60 * 60 * 24 * 7 })));
  return `${payload}.${await sign(payload, env.ADMIN_SESSION_SECRET)}`;
}

async function hasAdminSession(request: Request, env: Env) {
  const authorization = request.headers.get('authorization') || '';
  if (!authorization.startsWith('Bearer ')) return false;
  const [payload, signature] = authorization.slice(7).split('.');
  if (!payload || !signature) return false;
  const expected = await sign(payload, env.ADMIN_SESSION_SECRET);
  const left = encoder.encode(signature);
  const right = encoder.encode(expected);
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) mismatch |= left[index] ^ right[index];
  if (mismatch !== 0) return false;
  try {
    const payloadJson = JSON.parse(decoder.decode(fromBase64Url(payload)));
    return Number(payloadJson.exp) > Date.now();
  } catch {
    return false;
  }
}

async function passwordMatches(value: string, expected: string) {
  const [left, right] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(value)),
    crypto.subtle.digest('SHA-256', encoder.encode(expected)),
  ]);
  const a = new Uint8Array(left);
  const b = new Uint8Array(right);
  let mismatch = a.length ^ b.length;
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) mismatch |= a[index] ^ b[index];
  return mismatch === 0;
}

function mediaUrl(env: Env, key: string) {
  return `${trimSlashes(env.MEDIA_PUBLIC_URL)}/${key.split('/').map(encodeURIComponent).join('/')}`;
}

const responsiveImageWidths = new Set([480, 768, 1080, 1440, 1600, 1920]);
const supportedImageExtensions = new Set(['avif', 'gif', 'jpeg', 'jpg', 'png', 'webp']);

function transformWidth(value: string | null) {
  const width = Number(value || 1080);
  return responsiveImageWidths.has(width) ? width : 1080;
}

function negotiatedImageFormat(request: Request): 'avif' | 'webp' | undefined {
  const accept = request.headers.get('accept') || '';
  if (/image\/avif/i.test(accept)) return 'avif';
  if (/image\/webp/i.test(accept)) return 'webp';
  return undefined;
}

async function transformedMedia(request: Request, env: Env, url: URL) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return error(request, env, 405, '图片只支持读取。');

  let key = '';
  try {
    key = cleanObjectKey(decodeURIComponent(url.pathname.slice('/v1/media/'.length)));
  } catch {
    return error(request, env, 400, '图片路径无效。');
  }
  const extension = key.split('.').pop()?.toLowerCase() || '';
  if (!key || !supportedImageExtensions.has(extension)) return error(request, env, 400, '只支持图片文件。');

  const format = negotiatedImageFormat(request);
  const image = {
    fit: 'scale-down' as const,
    width: transformWidth(url.searchParams.get('width')),
    quality: 84,
    ...(format ? { format } : {}),
  };
  const response = await fetch(mediaUrl(env, key), { cf: { image } });
  if (!response.ok) return response;

  const headers = new Headers(response.headers);
  headers.set('cache-control', 'public, max-age=31536000, immutable');
  headers.set('vary', 'Accept');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function isR2Url(value: string, env: Env) {
  try {
    const url = new URL(value);
    const configuredHost = new URL(env.MEDIA_PUBLIC_URL).host;
    return url.host === configuredHost || url.hostname.endsWith('.r2.dev') || url.hostname.endsWith('.r2.cloudflarestorage.com');
  } catch {
    return false;
  }
}

function keyFromMedia(value: unknown, env: Env) {
  const raw = text(value, 2048);
  if (!raw) return '';
  if (!/^https?:\/\//i.test(raw)) return cleanObjectKey(raw);
  if (!isR2Url(raw, env)) return '';
  try {
    return cleanObjectKey(decodeURIComponent(new URL(raw).pathname.replace(/^\/+/, '')));
  } catch {
    return '';
  }
}

function rewriteMediaUrls(value: string, env: Env) {
  return value.replace(/https?:\/\/[^\s)\]<>"']+/g, (candidate) => {
    const key = keyFromMedia(candidate, env);
    return key ? mediaUrl(env, key) : candidate;
  });
}

function parseTags(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => text(item, 48)).filter(Boolean).slice(0, 16);
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parseTags(parsed) : value.split(/[,，]/).map((item) => text(item, 48)).filter(Boolean).slice(0, 16);
    } catch {
      return value.split(/[,，]/).map((item) => text(item, 48)).filter(Boolean).slice(0, 16);
    }
  }
  return [];
}

function row<T extends JsonRecord>(result: D1Result<T>) {
  return result.results[0] || null;
}

async function getTopicPhotos(env: Env, slug: string, previewOnly = false) {
  const statement = env.DB.prepare(
    previewOnly
      ? 'SELECT id, sort_order, title, pub_date, image_key, alt, caption FROM topic_photos WHERE topic_slug = ? ORDER BY sort_order ASC, id ASC LIMIT 3'
      : 'SELECT id, sort_order, title, pub_date, image_key, alt, caption FROM topic_photos WHERE topic_slug = ? ORDER BY sort_order ASC, id ASC',
  ).bind(slug).all<JsonRecord>();
  const result = await statement;
  return result.results.map((item) => ({
    id: Number(item.id),
    sortOrder: Number(item.sort_order),
    title: String(item.title),
    pubDate: String(item.pub_date),
    imageKey: String(item.image_key),
    imageUrl: mediaUrl(env, String(item.image_key)),
    alt: String(item.alt || ''),
    caption: String(item.caption || ''),
  }));
}

function publicPost(item: JsonRecord, includeBody = true) {
  return {
    slug: String(item.slug),
    title: String(item.title),
    description: String(item.description || ''),
    pubDate: String(item.pub_date),
    tags: parseTags(item.tags_json),
    draft: Boolean(item.draft),
    // JSON.stringify omits undefined, keeping list and home responses lean.
    body: includeBody ? String(item.body_markdown || '') : undefined,
  };
}

function publicPhoto(env: Env, item: JsonRecord) {
  return {
    slug: String(item.slug),
    title: String(item.title),
    location: String(item.location || ''),
    pubDate: String(item.pub_date),
    imageKey: String(item.image_key),
    imageUrl: mediaUrl(env, String(item.image_key)),
    alt: String(item.alt || ''),
    caption: String(item.caption || ''),
  };
}

async function publicTopic(env: Env, item: JsonRecord, includePhotos = true, previewOnly = false) {
  const topic = {
    slug: String(item.slug),
    title: String(item.title),
    description: String(item.description || ''),
    coverKey: String(item.cover_key || ''),
    coverUrl: item.cover_key ? mediaUrl(env, String(item.cover_key)) : '',
    coverAlt: String(item.cover_alt || ''),
    eyebrow: String(item.eyebrow || ''),
  };
  return { ...topic, photos: includePhotos ? await getTopicPhotos(env, topic.slug, previewOnly) : [] };
}

async function publicRequest(request: Request, env: Env, pathname: string) {
  if (pathname === '/v1/public/health') return json(request, env, { ok: true, service: 'icelin-blog-api' });

  if (pathname === '/v1/public/bootstrap') {
    const [posts, photos, topics] = await Promise.all([
      env.DB.prepare('SELECT slug, title, description, pub_date, tags_json, draft FROM posts WHERE draft = 0 ORDER BY pub_date DESC LIMIT 3').all<JsonRecord>(),
      env.DB.prepare('SELECT slug, title, location, pub_date, image_key, alt, caption FROM photos ORDER BY pub_date DESC LIMIT 3').all<JsonRecord>(),
      env.DB.prepare('SELECT slug, title, description, cover_key, cover_alt, eyebrow FROM topics ORDER BY title COLLATE NOCASE ASC').all<JsonRecord>(),
    ]);
    return json(request, env, {
      posts: posts.results.map((item) => publicPost(item, false)),
      photos: photos.results.map((item) => publicPhoto(env, item)),
      topics: await Promise.all(topics.results.map((item) => publicTopic(env, item, true, true))),
    }, { headers: { 'cache-control': 'public, max-age=60, stale-while-revalidate=300' } });
  }

  if (pathname === '/v1/public/posts') {
    const result = await env.DB.prepare('SELECT slug, title, description, pub_date, tags_json, draft FROM posts WHERE draft = 0 ORDER BY pub_date DESC').all<JsonRecord>();
    return json(request, env, { posts: result.results.map((item) => publicPost(item, false)) }, { headers: { 'cache-control': 'public, max-age=60, stale-while-revalidate=300' } });
  }

  if (pathname.startsWith('/v1/public/posts/')) {
    const slug = cleanSlug(decodeURIComponent(pathname.slice('/v1/public/posts/'.length)));
    const result = await env.DB.prepare('SELECT slug, title, description, body_markdown, pub_date, tags_json, draft FROM posts WHERE slug = ? AND draft = 0').bind(slug).all<JsonRecord>();
    const item = row(result);
    if (!item) return error(request, env, 404, '未找到这篇随笔。');
    const post = publicPost(item);
    return json(request, env, { post: { ...post, body: rewriteMediaUrls(post.body || '', env) } }, { headers: { 'cache-control': 'public, max-age=60, stale-while-revalidate=300' } });
  }

  if (pathname === '/v1/public/photos') {
    const result = await env.DB.prepare('SELECT slug, title, location, pub_date, image_key, alt, caption FROM photos ORDER BY pub_date DESC').all<JsonRecord>();
    return json(request, env, { photos: result.results.map((item) => publicPhoto(env, item)) }, { headers: { 'cache-control': 'public, max-age=60, stale-while-revalidate=300' } });
  }

  if (pathname === '/v1/public/topics') {
    const result = await env.DB.prepare('SELECT slug, title, description, cover_key, cover_alt, eyebrow FROM topics ORDER BY title COLLATE NOCASE ASC').all<JsonRecord>();
    return json(request, env, { topics: await Promise.all(result.results.map((item) => publicTopic(env, item, true, true))) }, { headers: { 'cache-control': 'public, max-age=60, stale-while-revalidate=300' } });
  }

  if (pathname.startsWith('/v1/public/topics/')) {
    const slug = cleanSlug(decodeURIComponent(pathname.slice('/v1/public/topics/'.length)));
    const result = await env.DB.prepare('SELECT slug, title, description, cover_key, cover_alt, eyebrow FROM topics WHERE slug = ?').bind(slug).all<JsonRecord>();
    const item = row(result);
    if (!item) return error(request, env, 404, '未找到这个专栏。');
    return json(request, env, { topic: await publicTopic(env, item, true) }, { headers: { 'cache-control': 'public, max-age=60, stale-while-revalidate=300' } });
  }

  if (pathname === '/v1/public/rss') return rss(request, env);
  return error(request, env, 404, '未找到公开接口。');
}

function escapeXml(value: string) {
  return value.replace(/[<>&"']/g, (character) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[character] || character);
}

async function rss(request: Request, env: Env) {
  const result = await env.DB.prepare('SELECT slug, title, description, pub_date FROM posts WHERE draft = 0 ORDER BY pub_date DESC').all<JsonRecord>();
  const site = trimSlashes(env.SITE_URL || env.ALLOWED_ORIGIN);
  const items = result.results.map((item) => {
    const link = `${site}/writing/${encodeURIComponent(String(item.slug))}/`;
    return `<item><title>${escapeXml(String(item.title))}</title><description>${escapeXml(String(item.description || ''))}</description><link>${link}</link><guid>${link}</guid><pubDate>${new Date(String(item.pub_date)).toUTCString()}</pubDate></item>`;
  }).join('');
  const headers = responseHeaders(request, env);
  headers.set('content-type', 'application/rss+xml; charset=utf-8');
  headers.set('cache-control', 'public, max-age=300');
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>icelin 随笔</title><link>${site}</link><description>生活随笔、摄影作品和个人日记。</description>${items}</channel></rss>`, { headers });
}

async function collectionSummary(env: Env) {
  const [posts, photos, topics, media] = await Promise.all([
    env.DB.prepare('SELECT COUNT(*) AS count FROM posts').first<JsonRecord>(),
    env.DB.prepare('SELECT COUNT(*) AS count FROM photos').first<JsonRecord>(),
    env.DB.prepare('SELECT COUNT(*) AS count FROM topics').first<JsonRecord>(),
    env.DB.prepare('SELECT COUNT(*) AS count FROM media_assets').first<JsonRecord>(),
  ]);
  return { writing: Number(posts?.count || 0), photos: Number(photos?.count || 0), topics: Number(topics?.count || 0), media: Number(media?.count || 0) };
}

async function listAdminPosts(env: Env) {
  const result = await env.DB.prepare('SELECT slug, title, description, pub_date, tags_json, draft, updated_at FROM posts ORDER BY pub_date DESC').all<JsonRecord>();
  return result.results.map((item) => ({ ...publicPost(item), updatedAt: String(item.updated_at || '') }));
}

async function listAdminPhotos(env: Env) {
  const result = await env.DB.prepare('SELECT slug, title, location, pub_date, image_key, alt, caption, updated_at FROM photos ORDER BY pub_date DESC').all<JsonRecord>();
  return result.results.map((item) => ({ ...publicPhoto(env, item), updatedAt: String(item.updated_at || '') }));
}

async function listAdminTopics(env: Env) {
  const result = await env.DB.prepare('SELECT slug, title, description, cover_key, cover_alt, eyebrow, updated_at FROM topics ORDER BY title COLLATE NOCASE ASC').all<JsonRecord>();
  return Promise.all(result.results.map(async (item) => ({ ...(await publicTopic(env, item, true)), updatedAt: String(item.updated_at || '') })));
}

async function savePost(env: Env, data: JsonRecord, existingSlug = '') {
  const slug = existingSlug || cleanSlug(data.slug || data.title);
  if (!slug) throw new Error('请填写可用的随笔 slug 或标题。');
  const title = text(data.title, 180);
  if (!title) throw new Error('请填写标题。');
  const description = text(data.description, 500);
  const body = text(data.body, 100000);
  const pubDate = isoDate(data.pubDate);
  const tags = JSON.stringify(parseTags(data.tags));
  const draft = bool(data.draft) ? 1 : 0;
  await env.DB.prepare(
    `INSERT INTO posts (slug, title, description, body_markdown, pub_date, tags_json, draft)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(slug) DO UPDATE SET title = excluded.title, description = excluded.description, body_markdown = excluded.body_markdown, pub_date = excluded.pub_date, tags_json = excluded.tags_json, draft = excluded.draft, updated_at = CURRENT_TIMESTAMP`,
  ).bind(slug, title, description, body, pubDate, tags, draft).run();
  const item = await env.DB.prepare('SELECT slug, title, description, body_markdown, pub_date, tags_json, draft FROM posts WHERE slug = ?').bind(slug).first<JsonRecord>();
  return publicPost(item || {});
}

async function savePhoto(env: Env, data: JsonRecord, existingSlug = '') {
  const slug = existingSlug || cleanSlug(data.slug || data.title);
  if (!slug) throw new Error('请填写可用的摄影 slug 或标题。');
  const title = text(data.title, 180);
  const imageKey = keyFromMedia(data.imageKey || data.imageUrl, env);
  if (!title || !imageKey) throw new Error('摄影作品需要标题和 R2 图片。');
  await env.DB.prepare(
    `INSERT INTO photos (slug, title, location, pub_date, image_key, alt, caption)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(slug) DO UPDATE SET title = excluded.title, location = excluded.location, pub_date = excluded.pub_date, image_key = excluded.image_key, alt = excluded.alt, caption = excluded.caption, updated_at = CURRENT_TIMESTAMP`,
  ).bind(slug, title, text(data.location, 180), isoDate(data.pubDate), imageKey, text(data.alt, 500), text(data.caption, 1600)).run();
  const item = await env.DB.prepare('SELECT slug, title, location, pub_date, image_key, alt, caption FROM photos WHERE slug = ?').bind(slug).first<JsonRecord>();
  return publicPhoto(env, item || {});
}

async function saveTopic(env: Env, data: JsonRecord, existingSlug = '') {
  const slug = existingSlug || cleanSlug(data.slug || data.title);
  if (!slug) throw new Error('请先填写专题名称或 slug。');
  const title = text(data.title, 180);
  if (!title) throw new Error('请填写专题名称。');
  const coverKey = keyFromMedia(data.coverKey || data.coverUrl, env);
  const incomingPhotos = Array.isArray(data.photos) ? data.photos : [];
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(
      `INSERT INTO topics (slug, title, description, cover_key, cover_alt, eyebrow)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(slug) DO UPDATE SET title = excluded.title, description = excluded.description, cover_key = excluded.cover_key, cover_alt = excluded.cover_alt, eyebrow = excluded.eyebrow, updated_at = CURRENT_TIMESTAMP`,
    ).bind(slug, title, text(data.description, 1600), coverKey, text(data.coverAlt, 500), text(data.eyebrow, 180)),
    env.DB.prepare('DELETE FROM topic_photos WHERE topic_slug = ?').bind(slug),
  ];
  incomingPhotos.forEach((photo, index) => {
    if (!photo || typeof photo !== 'object') return;
    const item = photo as JsonRecord;
    const imageKey = keyFromMedia(item.imageKey || item.imageUrl, env);
    const photoTitle = text(item.title, 180);
    if (!imageKey || !photoTitle) return;
    statements.push(env.DB.prepare(
      'INSERT INTO topic_photos (topic_slug, sort_order, title, pub_date, image_key, alt, caption) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).bind(slug, index, photoTitle, isoDate(item.pubDate), imageKey, text(item.alt, 500), text(item.caption, 1600)));
  });
  await env.DB.batch(statements);
  const item = await env.DB.prepare('SELECT slug, title, description, cover_key, cover_alt, eyebrow FROM topics WHERE slug = ?').bind(slug).first<JsonRecord>();
  return publicTopic(env, item || {}, true);
}

async function usageByKey(env: Env) {
  const usage = new Map<string, Usage[]>();
  const add = (key: string, item: Usage) => {
    if (!key) return;
    const entries = usage.get(key) || [];
    entries.push(item);
    usage.set(key, entries);
  };
  const [photos, topics, topicPhotos, posts] = await Promise.all([
    env.DB.prepare('SELECT slug, title, image_key FROM photos').all<JsonRecord>(),
    env.DB.prepare('SELECT slug, title, cover_key FROM topics').all<JsonRecord>(),
    env.DB.prepare('SELECT topic_slug, title, image_key FROM topic_photos').all<JsonRecord>(),
    env.DB.prepare('SELECT slug, title, body_markdown FROM posts').all<JsonRecord>(),
  ]);
  photos.results.forEach((item) => add(String(item.image_key), { collection: 'photos', slug: String(item.slug), title: String(item.title), field: 'image' }));
  topics.results.forEach((item) => add(String(item.cover_key || ''), { collection: 'topics', slug: String(item.slug), title: String(item.title), field: 'cover' }));
  topicPhotos.results.forEach((item) => add(String(item.image_key), { collection: 'topics', slug: String(item.topic_slug), title: String(item.title), field: 'photo' }));
  posts.results.forEach((item) => {
    const body = String(item.body_markdown || '');
    body.match(/https?:\/\/[^\s)\]<>"']+/g)?.forEach((candidate) => {
      const key = keyFromMedia(candidate, env);
      if (key) add(key, { collection: 'writing', slug: String(item.slug), title: String(item.title), field: 'body' });
    });
  });
  return usage;
}

function filename(value: string, contentType = '') {
  const source = decodeURIComponent(value.split('/').pop() || '');
  const extensionMatch = source.match(/\.([a-z0-9]{2,8})$/i);
  const extension = extensionMatch?.[1].toLowerCase() || ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/avif': 'avif', 'image/gif': 'gif' }[contentType] || 'webp');
  const base = source
    .replace(/\.[^.]+$/, '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72);
  return `${base || `image-${Date.now()}`}.${extension}`;
}

async function ensureMediaFolder(env: Env, folder: string) {
  if (folder === 'photos' || folder === 'writing') return folder;
  const topic = await env.DB.prepare('SELECT slug FROM topics WHERE slug = ?').bind(folder).first();
  if (!topic) throw new Error('请先保存专题，再向该专题上传图片。');
  return folder;
}

async function listMedia(request: Request, env: Env, url: URL) {
  const prefix = cleanFolder(url.searchParams.get('prefix') || '');
  const cursor = url.searchParams.get('cursor') || undefined;
  const listed = await env.MEDIA.list({ prefix: prefix ? `${prefix}/` : undefined, cursor, limit: 1000 });
  const usage = await usageByKey(env);
  const objects = listed.objects.map((object) => ({
    key: object.key,
    name: object.key.split('/').pop() || object.key,
    folder: object.key.split('/').slice(0, -1).join('/'),
    size: object.size,
    uploadedAt: object.uploaded.toISOString(),
    imageUrl: mediaUrl(env, object.key),
    usedBy: usage.get(object.key) || [],
  }));
  return json(request, env, { objects, cursor: listed.truncated ? listed.cursor : null });
}

async function uploadMedia(request: Request, env: Env) {
  const form = await request.formData();
  const original = form.get('file');
  const folder = cleanFolder(form.get('folder') || '');
  if (!original || typeof original === 'string') throw new Error('请选择要上传的图片。');
  if (!folder) throw new Error('未确定 R2 目标文件夹。');
  if (!String(original.type || '').startsWith('image/')) throw new Error('这里只能上传图片文件。');
  const targetFolder = await ensureMediaFolder(env, folder);
  const proposed = filename(original.name, original.type);
  const extension = proposed.match(/\.[^.]+$/)?.[0] || '';
  const stem = proposed.slice(0, proposed.length - extension.length);
  let key = `${targetFolder}/${proposed}`;
  let index = 2;
  while (await env.MEDIA.head(key)) {
    key = `${targetFolder}/${stem}-${index}${extension}`;
    index += 1;
  }
  await env.MEDIA.put(key, original, {
    httpMetadata: { contentType: original.type || 'application/octet-stream' },
    customMetadata: { originalName: original.name.slice(0, 240) },
  });
  await env.DB.prepare(
    `INSERT INTO media_assets (object_key, folder, file_name, content_type, byte_size)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(object_key) DO UPDATE SET content_type = excluded.content_type, byte_size = excluded.byte_size, updated_at = CURRENT_TIMESTAMP`,
  ).bind(key, targetFolder, key.split('/').pop(), original.type || '', original.size).run();
  return { key, name: key.split('/').pop(), folder: targetFolder, size: original.size, imageUrl: mediaUrl(env, key) };
}

async function deleteMedia(request: Request, env: Env, url: URL) {
  const key = keyFromMedia(url.searchParams.get('key') || '', env);
  if (!key) throw new Error('缺少要删除的 R2 文件。');
  const usage = await usageByKey(env);
  const usedBy = usage.get(key) || [];
  if (usedBy.length && url.searchParams.get('force') !== '1') {
    return error(request, env, 409, '该图片仍被内容引用，不能直接删除。', { usedBy });
  }
  await env.MEDIA.delete(key);
  await env.DB.prepare('DELETE FROM media_assets WHERE object_key = ?').bind(key).run();
  return json(request, env, { ok: true, key });
}

async function adminRequest(request: Request, env: Env, pathname: string, url: URL) {
  if (pathname === '/v1/admin/login' && request.method === 'POST') {
    const data = await readJson(request);
    if (!await passwordMatches(text(data.password, 512), env.ADMIN_PASSWORD)) return error(request, env, 401, '密码不正确。');
    return json(request, env, { token: await sessionToken(env), expiresIn: 60 * 60 * 24 * 7 });
  }

  if (!await hasAdminSession(request, env)) return error(request, env, 401, '请先登录编辑室。');
  if (pathname === '/v1/admin/session') return json(request, env, { authenticated: true });
  if (pathname === '/v1/admin/summary') return json(request, env, { summary: await collectionSummary(env) });

  if (pathname === '/v1/admin/media') {
    if (request.method === 'GET') return listMedia(request, env, url);
    if (request.method === 'POST') return json(request, env, { asset: await uploadMedia(request, env) }, { status: 201 });
    if (request.method === 'DELETE') return deleteMedia(request, env, url);
  }

  const match = pathname.match(/^\/v1\/admin\/(posts|photos|topics)(?:\/([^/]+))?$/);
  if (!match) return error(request, env, 404, '未找到管理接口。');
  const collection = match[1];
  const slug = match[2] ? cleanSlug(decodeURIComponent(match[2])) : '';

  if (!slug && request.method === 'GET') {
    const items = collection === 'posts' ? await listAdminPosts(env) : collection === 'photos' ? await listAdminPhotos(env) : await listAdminTopics(env);
    return json(request, env, { items });
  }
  if (!slug && request.method === 'POST') {
    const data = await readJson(request);
    const item = collection === 'posts' ? await savePost(env, data) : collection === 'photos' ? await savePhoto(env, data) : await saveTopic(env, data);
    return json(request, env, { item }, { status: 201 });
  }
  if (!slug) return error(request, env, 405, '该操作需要内容 slug。');

  if (request.method === 'GET') {
    if (collection === 'posts') {
      const item = await env.DB.prepare('SELECT slug, title, description, body_markdown, pub_date, tags_json, draft FROM posts WHERE slug = ?').bind(slug).first<JsonRecord>();
      return item ? json(request, env, { item: publicPost(item) }) : error(request, env, 404, '未找到随笔。');
    }
    if (collection === 'photos') {
      const item = await env.DB.prepare('SELECT slug, title, location, pub_date, image_key, alt, caption FROM photos WHERE slug = ?').bind(slug).first<JsonRecord>();
      return item ? json(request, env, { item: publicPhoto(env, item) }) : error(request, env, 404, '未找到摄影作品。');
    }
    const item = await env.DB.prepare('SELECT slug, title, description, cover_key, cover_alt, eyebrow FROM topics WHERE slug = ?').bind(slug).first<JsonRecord>();
    return item ? json(request, env, { item: await publicTopic(env, item, true) }) : error(request, env, 404, '未找到专题。');
  }
  if (request.method === 'PUT') {
    const data = await readJson(request);
    const item = collection === 'posts' ? await savePost(env, data, slug) : collection === 'photos' ? await savePhoto(env, data, slug) : await saveTopic(env, data, slug);
    return json(request, env, { item });
  }
  if (request.method === 'DELETE') {
    const table = collection === 'posts' ? 'posts' : collection === 'photos' ? 'photos' : 'topics';
    await env.DB.prepare(`DELETE FROM ${table} WHERE slug = ?`).bind(slug).run();
    return json(request, env, { ok: true, slug });
  }
  return error(request, env, 405, '不支持这个请求方法。');
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') {
      return originIsAllowed(request, env) ? empty(request, env, { status: 204 }) : new Response(null, { status: 403 });
    }
    if (!originIsAllowed(request, env)) return error(request, env, 403, '此来源无权访问编辑接口。');
    try {
      if (url.pathname.startsWith('/v1/media/')) return await transformedMedia(request, env, url);
      if (url.pathname.startsWith('/v1/public/')) return await publicRequest(request, env, url.pathname);
      if (url.pathname.startsWith('/v1/admin/')) return await adminRequest(request, env, url.pathname, url);
      return error(request, env, 404, '未找到接口。');
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : '服务器处理请求时出错。';
      return error(request, env, 400, message);
    }
  },
} satisfies ExportedHandler<Env>;
