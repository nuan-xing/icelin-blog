import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const publicDir = path.join(root, 'public');
const sourceImageDir = path.join(publicDir, 'images');
const generatedImageDir = path.join(publicDir, 'generated', 'images');
const manifestPath = path.join(root, 'src', 'data', 'generated-image-manifest.json');

const widths = [360, 640, 960, 1280];
const imageExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif']);

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

async function generateImages() {
  if (!existsSync(sourceImageDir)) return {};

  await rm(generatedImageDir, { recursive: true, force: true });
  await mkdir(generatedImageDir, { recursive: true });

  const manifest = {};
  const files = (await walk(sourceImageDir)).filter((file) => imageExtensions.has(path.extname(file).toLowerCase()));

  for (const file of files) {
    const relativePath = path.relative(sourceImageDir, file);
    const publicSource = `/images/${toPosix(relativePath)}`;
    const parsed = path.parse(relativePath);
    const metadata = await sharp(file).metadata();

    if (!metadata.width || !metadata.height) continue;

    const targetWidths = widths.filter((width) => width < metadata.width);
    const normalizedWidths = targetWidths.length > 0 ? targetWidths : [metadata.width];
    const variants = [];

    for (const width of normalizedWidths) {
      const outputRelative = path.join(parsed.dir, `${parsed.name}-${width}.webp`);
      const outputFile = path.join(generatedImageDir, outputRelative);
      await mkdir(path.dirname(outputFile), { recursive: true });

      await sharp(file)
        .rotate()
        .resize({ width, withoutEnlargement: true })
        .webp({ quality: 72, effort: 5 })
        .toFile(outputFile);

      const outputStats = await stat(outputFile);
      variants.push({
        width,
        src: `/generated/images/${toPosix(outputRelative)}`,
        bytes: outputStats.size,
      });
    }

    manifest[publicSource] = {
      width: metadata.width,
      height: metadata.height,
      src: variants.at(-1)?.src ?? publicSource,
      srcset: variants.map((variant) => `${variant.src} ${variant.width}w`).join(', '),
      variants,
    };
  }

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
  console.log(`Generated ${Object.keys(manifest).length} responsive image records.`);
}

await generateImages();
