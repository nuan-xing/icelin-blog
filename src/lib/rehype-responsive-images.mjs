import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { getPublicR2MediaUrl, getResponsiveImageSrcset, getTransformedImageUrl, isR2MediaUrl } from './media.mjs';

const manifestPath = path.resolve('src/data/generated-image-manifest.json');

function loadManifest() {
  if (!existsSync(manifestPath)) return {};
  return JSON.parse(readFileSync(manifestPath, 'utf8'));
}

function visit(node, callback) {
  callback(node);

  if (!Array.isArray(node.children)) return;

  for (const child of node.children) {
    visit(child, callback);
  }
}

export default function rehypeResponsiveImages(options = {}) {
  const manifest = loadManifest();
  const defaultSizes = options.sizes ?? '(max-width: 760px) calc(100vw - 28px), 760px';

  return (tree) => {
    visit(tree, (node) => {
      if (node.type !== 'element' || node.tagName !== 'img') return;

      const src = node.properties?.src;
      if (typeof src !== 'string') return;

      const record = manifest[src];
      const externalSrcset = getResponsiveImageSrcset(src);
      const externalR2 = isR2MediaUrl(src);
      if (!record && !externalSrcset && !externalR2) return;

      node.properties = {
        ...node.properties,
        src: record?.src ?? (externalR2 ? getTransformedImageUrl(src, 1080) : getPublicR2MediaUrl(src)),
        srcset: record?.srcset ?? externalSrcset,
        sizes: node.properties.sizes ?? defaultSizes,
        ...(record ? { width: record.width, height: record.height } : {}),
        loading: node.properties.loading ?? 'lazy',
        decoding: node.properties.decoding ?? 'async',
      };
    });
  };
}
