import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const contentRoot = path.join(root, 'src', 'content');
const schemaPath = path.join(root, 'database', '0001_content.sql');
const generatedSqlPath = path.join(root, 'database', 'seed.generated.sql');
const args = new Set(process.argv.slice(2));
const execute = args.has('--execute');

const sql = (value) => `'${String(value ?? '').replace(/'/g, "''")}'`;
const toPosix = (value) => value.split(path.sep).join('/');

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(target) : target;
  }));
  return files.flat();
}

function asDate(value) {
  const date = value instanceof Date ? value : new Date(String(value || ''));
  return Number.isNaN(date.valueOf()) ? new Date().toISOString() : date.toISOString();
}

function text(value, limit = 100000) {
  return String(value ?? '').trim().slice(0, limit);
}

function slugFromFile(file) {
  return toPosix(path.relative(contentRoot, file)).replace(/^.*\//, '').replace(/\.md$/i, '');
}

function mediaKey(value) {
  const raw = text(value, 2048);
  if (!raw) return '';
  if (!/^https?:\/\//i.test(raw)) return raw.replace(/^\/+/, '');
  try {
    const url = new URL(raw);
    if (!url.hostname.endsWith('.r2.dev') && !url.hostname.endsWith('.r2.cloudflarestorage.com')) return '';
    return decodeURIComponent(url.pathname.replace(/^\/+/, ''));
  } catch {
    return '';
  }
}

function imageKeysInMarkdown(value) {
  return [...String(value || '').matchAll(/https?:\/\/[^\s)\]<>"']+/g)]
    .map(([url]) => mediaKey(url))
    .filter(Boolean);
}

function assetStatement(key) {
  const parts = key.split('/');
  const folder = parts.slice(0, -1).join('/') || 'misc';
  const name = parts.at(-1) || key;
  return `INSERT OR IGNORE INTO media_assets (object_key, folder, file_name) VALUES (${sql(key)}, ${sql(folder)}, ${sql(name)});`;
}

async function loadEntries(collection) {
  const directory = path.join(contentRoot, collection);
  if (!existsSync(directory)) return [];
  const files = (await walk(directory)).filter((file) => path.extname(file).toLowerCase() === '.md');
  return Promise.all(files.map(async (file) => ({ file, slug: slugFromFile(file), parsed: matter(await readFile(file, 'utf8')) })));
}

async function buildSeed() {
  const [writing, photos, topics] = await Promise.all([
    loadEntries('writing'),
    loadEntries('photos'),
    loadEntries('topics'),
  ]);
  // Remote D1 SQL imports manage atomicity themselves and reject explicit
  // BEGIN/COMMIT statements, so each generated statement is independently
  // idempotent through UPSERT / INSERT OR IGNORE.
  const statements = ['PRAGMA foreign_keys = ON;'];
  const assets = new Set();

  for (const entry of writing) {
    const data = entry.parsed.data;
    const tags = Array.isArray(data.tags) ? data.tags.map((tag) => text(tag, 48)).filter(Boolean) : [];
    statements.push(
      `INSERT INTO posts (slug, title, description, body_markdown, pub_date, tags_json, draft)
       VALUES (${sql(entry.slug)}, ${sql(text(data.title, 180))}, ${sql(text(data.description, 500))}, ${sql(entry.parsed.content)}, ${sql(asDate(data.pubDate))}, ${sql(JSON.stringify(tags))}, ${data.draft ? 1 : 0})
       ON CONFLICT(slug) DO UPDATE SET title = excluded.title, description = excluded.description, body_markdown = excluded.body_markdown, pub_date = excluded.pub_date, tags_json = excluded.tags_json, draft = excluded.draft, updated_at = CURRENT_TIMESTAMP;`,
    );
    imageKeysInMarkdown(entry.parsed.content).forEach((key) => assets.add(key));
  }

  for (const entry of photos) {
    const data = entry.parsed.data;
    const key = mediaKey(data.image);
    if (key) assets.add(key);
    statements.push(
      `INSERT INTO photos (slug, title, location, pub_date, image_key, alt, caption)
       VALUES (${sql(entry.slug)}, ${sql(text(data.title, 180))}, ${sql(text(data.location, 180))}, ${sql(asDate(data.pubDate))}, ${sql(key)}, ${sql(text(data.alt, 500))}, ${sql(text(data.caption, 1600))})
       ON CONFLICT(slug) DO UPDATE SET title = excluded.title, location = excluded.location, pub_date = excluded.pub_date, image_key = excluded.image_key, alt = excluded.alt, caption = excluded.caption, updated_at = CURRENT_TIMESTAMP;`,
    );
  }

  for (const entry of topics) {
    const data = entry.parsed.data;
    const coverKey = mediaKey(data.coverImage);
    if (coverKey) assets.add(coverKey);
    statements.push(
      `INSERT INTO topics (slug, title, description, cover_key, cover_alt, eyebrow)
       VALUES (${sql(entry.slug)}, ${sql(text(data.title, 180))}, ${sql(text(data.description, 1600))}, ${sql(coverKey)}, ${sql(text(data.coverAlt, 500))}, ${sql(text(data.eyebrow, 180))})
       ON CONFLICT(slug) DO UPDATE SET title = excluded.title, description = excluded.description, cover_key = excluded.cover_key, cover_alt = excluded.cover_alt, eyebrow = excluded.eyebrow, updated_at = CURRENT_TIMESTAMP;`,
    );
    statements.push(`DELETE FROM topic_photos WHERE topic_slug = ${sql(entry.slug)};`);
    (Array.isArray(data.photos) ? data.photos : []).forEach((photo, index) => {
      const key = mediaKey(photo?.image);
      if (key) assets.add(key);
      statements.push(
        `INSERT INTO topic_photos (topic_slug, sort_order, title, pub_date, image_key, alt, caption)
         VALUES (${sql(entry.slug)}, ${index}, ${sql(text(photo?.title, 180))}, ${sql(asDate(photo?.pubDate))}, ${sql(key)}, ${sql(text(photo?.alt, 500))}, ${sql(text(photo?.caption, 1600))});`,
      );
    });
  }

  [...assets].sort().forEach((key) => statements.push(assetStatement(key)));
  return {
    sql: `${statements.join('\n')}\n`,
    summary: { writing: writing.length, photos: photos.length, topics: topics.length, assets: assets.size },
  };
}

function runWrangler(argumentsList) {
  const command = process.platform === 'win32'
    ? path.join(root, 'node_modules', '.bin', 'wrangler.cmd')
    : path.join(root, 'node_modules', '.bin', 'wrangler');
  return new Promise((resolve, reject) => {
    const child = spawn(command, argumentsList, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`Wrangler exited with code ${code}.`)));
  });
}

if (args.has('--help')) {
  console.log('用法：node scripts/migrate-content-to-d1.mjs [--execute]');
  console.log('默认只生成迁移预览。--execute 会先建立 schema，再写入远程 D1 数据库 blog。');
  process.exit(0);
}

const seed = await buildSeed();
console.log(`[${execute ? 'execute' : 'dry-run'}] 随笔 ${seed.summary.writing} 篇，摄影 ${seed.summary.photos} 条，专题 ${seed.summary.topics} 个，R2 图片引用 ${seed.summary.assets} 个。`);

if (!execute) {
  console.log('没有写入 D1。添加 --execute 后会生成临时 SQL 并写入远程 D1。');
  process.exit(0);
}

await mkdir(path.dirname(generatedSqlPath), { recursive: true });
await writeFile(generatedSqlPath, seed.sql);
try {
  await runWrangler(['d1', 'execute', 'blog', '--remote', '--file', schemaPath]);
  await runWrangler(['d1', 'execute', 'blog', '--remote', '--file', generatedSqlPath]);
  console.log('D1 内容迁移完成。原始 Markdown 没有被删除，仍可作为回滚备份。');
} finally {
  // The generated file is ignored by Git, but remains locally for an audit.
  console.log(`迁移 SQL：${path.relative(root, generatedSqlPath)}`);
}
