import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const publicDir = path.join(root, 'public');
const sourceImageDir = path.join(publicDir, 'images');
const photoImageDir = path.join(sourceImageDir, 'photos');
const generatedImageDir = path.join(publicDir, 'generated', 'images');
const manifestPath = path.join(root, 'src', 'data', 'generated-image-manifest.json');
const mediaStatusPath = path.join(publicDir, 'admin', 'media-status.json');
const cachePath = path.join(root, 'node_modules', '.cache', 'icelin-media.json');
const astroCacheDir = path.join(root, '.astro');
const astroContentStoreDir = path.join(root, 'node_modules', '.astro');
const externalMediaBaseUrl = 'https://pub-2ab46ecc311a40e79c4d8c69c5f9da25.r2.dev';

const widths = [480, 768, 1080, 1440, 1600];
const webpOptions = { quality: 84, effort: 5 };
const pipelineSignature = JSON.stringify({ widths, webpOptions });
const imageExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif']);
const requestedConcurrency = Number.parseInt(process.env.MEDIA_CONCURRENCY ?? '', 10);
const concurrency = Number.isFinite(requestedConcurrency)
  ? Math.max(1, requestedConcurrency)
  : Math.max(1, Math.min(4, availableParallelism()));

const toPosix = (value) => value.split(path.sep).join('/');

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const fullPath = path.join(dir, entry.name);
      return entry.isDirectory() ? walk(fullPath) : fullPath;
    }),
  );

  return files.flat();
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function run() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

function outputFileFromPublicPath(publicPath) {
  return path.join(publicDir, publicPath.replace(/^\//, '').split('/').join(path.sep));
}

function readFrontmatterValue(frontmatter, key) {
  const match = frontmatter.match(new RegExp(`^${key}:\\s*(.*)$`, 'm'));
  if (!match) return '';

  const value = match[1].trim();
  const quoted = value.match(/^(?:"([\s\S]*)"|'([\s\S]*)')$/);
  return (quoted?.[1] ?? quoted?.[2] ?? value).trim();
}

async function generatePhotoMediaStatus() {
  const photoContentDir = path.join(root, 'src', 'content', 'photos');
  const contentDir = path.join(root, 'src', 'content');
  const [imageFiles, entryFiles, contentFiles] = await Promise.all([
    existsSync(photoImageDir) ? walk(photoImageDir) : [],
    existsSync(photoContentDir) ? walk(photoContentDir) : [],
    existsSync(contentDir) ? walk(contentDir) : [],
  ]);
  const entries = await Promise.all(
    entryFiles
      .filter((file) => path.extname(file).toLowerCase() === '.md')
      .map(async (file) => {
        const content = await readFile(file, 'utf8');
        const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? '';
        return {
          title: readFrontmatterValue(frontmatter, 'title') || path.basename(file, '.md'),
          slug: toPosix(path.relative(photoContentDir, file)).replace(/\.md$/i, ''),
          image: readFrontmatterValue(frontmatter, 'image'),
          href: `/admin/#/collections/photos/entries/${encodeURIComponent(toPosix(path.relative(photoContentDir, file)).replace(/\.md$/i, ''))}`,
        };
      }),
  );
  const localAssets = imageFiles
    .filter((file) => imageExtensions.has(path.extname(file).toLowerCase()))
    .sort((a, b) => a.localeCompare(b, 'en'))
    .map((file) => {
      const relativePath = toPosix(path.relative(sourceImageDir, file));
      const src = `/images/${relativePath}`;
      return {
        name: path.basename(file),
        src,
        usedBy: entries
          .filter((entry) => entry.image === src)
          .map(({ title, slug, href }) => ({ title, slug, href })),
      };
    });

  const externalAssets = new Map();
  const externalPrefix = `${externalMediaBaseUrl}/`;
  for (const file of contentFiles.filter((candidate) => path.extname(candidate).toLowerCase() === '.md')) {
    const content = await readFile(file, 'utf8');
    const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? '';
    const relative = toPosix(path.relative(contentDir, file));
    const collection = relative.split('/')[0];
    const slug = relative.replace(/^.+\//, '').replace(/\.md$/i, '');
    const usage = {
      title: readFrontmatterValue(frontmatter, 'title') || slug,
      slug,
      href: `/admin/#/collections/${collection}/entries/${encodeURIComponent(slug)}`,
    };
    let cursor = 0;
    while ((cursor = content.indexOf(externalPrefix, cursor)) !== -1) {
      const keyStart = cursor + externalPrefix.length;
      const key = content.slice(keyStart).split(/[\s)"']/, 1)[0];
      if (!key) break;
      const src = `${externalPrefix}${key}`;
      const asset = externalAssets.get(src) ?? {
        name: path.posix.basename(key),
        src,
        usedBy: [],
      };
      if (!asset.usedBy.some((entry) => entry.href === usage.href)) asset.usedBy.push(usage);
      externalAssets.set(src, asset);
      cursor = keyStart + key.length;
    }
  }

  const assets = [...localAssets, ...externalAssets.values()]
    .sort((a, b) => a.name.localeCompare(b.name, 'en'));

  const status = {
    generatedAt: new Date().toISOString(),
    folder: 'Cloudflare R2 · icelin-blog-media',
    assets,
  };
  await mkdir(path.dirname(mediaStatusPath), { recursive: true });
  await writeFile(mediaStatusPath, `${JSON.stringify(status, null, 2)}\n`);
}

async function cacheRecordIsUsable(cached) {
  if (!cached || cached.signature !== pipelineSignature || !cached.record?.variants?.length) return false;
  return cached.record.variants.every((variant) => existsSync(outputFileFromPublicPath(variant.src)));
}

async function processImage(file, previousCache) {
  const relativePath = path.relative(sourceImageDir, file);
  const publicSource = `/images/${toPosix(relativePath)}`;
  const hash = createHash('sha256').update(await readFile(file)).digest('hex');
  const cached = previousCache.records?.[publicSource];

  if (cached?.hash === hash && await cacheRecordIsUsable(cached)) {
    return { publicSource, record: cached.record, cacheRecord: cached, generated: false };
  }

  const parsed = path.parse(relativePath);
  const metadata = await sharp(file).metadata();

  if (!metadata.width || !metadata.height) return null;

  const targetWidths = widths.filter((width) => width < metadata.width);
  if (metadata.width <= widths.at(-1) && !targetWidths.includes(metadata.width)) {
    targetWidths.push(metadata.width);
  }

  const normalizedWidths = targetWidths.length > 0 ? targetWidths : [metadata.width];
  const variants = [];

  for (const width of normalizedWidths) {
    const outputRelative = path.join(parsed.dir, `${parsed.name}-${width}.webp`);
    const outputFile = path.join(generatedImageDir, outputRelative);
    await mkdir(path.dirname(outputFile), { recursive: true });

    await sharp(file)
      .rotate()
      .resize({ width, withoutEnlargement: true })
      .webp(webpOptions)
      .toFile(outputFile);

    const outputStats = await stat(outputFile);
    variants.push({
      width,
      src: `/generated/images/${toPosix(outputRelative)}`,
      bytes: outputStats.size,
    });
  }

  const record = {
    width: metadata.width,
    height: metadata.height,
    src: variants.at(-1)?.src ?? publicSource,
    srcset: variants.map((variant) => `${variant.src} ${variant.width}w`).join(', '),
    variants,
  };

  return {
    publicSource,
    record,
    cacheRecord: { hash, signature: pipelineSignature, record },
    generated: true,
  };
}

async function generateImages() {
  if (!existsSync(sourceImageDir)) {
    await rm(generatedImageDir, { recursive: true, force: true });
    await mkdir(path.dirname(manifestPath), { recursive: true });
    await writeFile(manifestPath, '{}\n');
    await generatePhotoMediaStatus();
    await mkdir(path.dirname(cachePath), { recursive: true });
    await writeFile(cachePath, `${JSON.stringify({ records: {} })}\n`);
    await Promise.all([
      rm(astroCacheDir, { recursive: true, force: true }),
      rm(astroContentStoreDir, { recursive: true, force: true }),
    ]);
    console.log('No local image source directory found; using external media URLs.');
    return {};
  }

  await mkdir(generatedImageDir, { recursive: true });

  const previousCache = await readJson(cachePath, { records: {} });
  const files = (await walk(sourceImageDir))
    .filter((file) => imageExtensions.has(path.extname(file).toLowerCase()))
    .sort((a, b) => a.localeCompare(b, 'en'));
  const processed = (await mapLimit(files, concurrency, (file) => processImage(file, previousCache)))
    .filter(Boolean);
  const manifest = Object.fromEntries(processed.map(({ publicSource, record }) => [publicSource, record]));
  const cache = {
    records: Object.fromEntries(processed.map(({ publicSource, cacheRecord }) => [publicSource, cacheRecord])),
  };

  const expectedFiles = new Set(
    processed.flatMap(({ record }) => record.variants.map((variant) => path.resolve(outputFileFromPublicPath(variant.src)))),
  );
  const generatedFiles = (await walk(generatedImageDir)).filter((file) => imageExtensions.has(path.extname(file).toLowerCase()));
  await Promise.all(
    generatedFiles
      .filter((file) => !expectedFiles.has(path.resolve(file)))
      .map((file) => rm(file, { force: true })),
  );

  await mkdir(path.dirname(manifestPath), { recursive: true });
  await writeFile(`${manifestPath}.tmp`, `${JSON.stringify(manifest, null, 2)}\n`);

  let shouldWrite = true;
  if (existsSync(manifestPath)) {
    shouldWrite = (await readFile(manifestPath, 'utf8')) !== (await readFile(`${manifestPath}.tmp`, 'utf8'));
  }

  if (shouldWrite) {
    await rm(manifestPath, { force: true });
    await writeFile(manifestPath, await readFile(`${manifestPath}.tmp`, 'utf8'));
  }

  await rm(`${manifestPath}.tmp`, { force: true });

  await generatePhotoMediaStatus();

  await mkdir(path.dirname(cachePath), { recursive: true });
  await writeFile(cachePath, `${JSON.stringify(cache)}\n`);

  // Markdown rendering can otherwise retain srcsets from an older manifest.
  await Promise.all([
    rm(astroCacheDir, { recursive: true, force: true }),
    rm(astroContentStoreDir, { recursive: true, force: true }),
  ]);

  const generatedCount = processed.filter(({ generated }) => generated).length;
  console.log(
    `Prepared ${processed.length} responsive image records (${generatedCount} regenerated, ${processed.length - generatedCount} reused).`,
  );
}

await generateImages();
