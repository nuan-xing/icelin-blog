import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

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
      if (!record) return;

      node.properties = {
        ...node.properties,
        src: record.src,
        srcset: record.srcset,
        sizes: node.properties.sizes ?? defaultSizes,
        width: record.width,
        height: record.height,
        loading: node.properties.loading ?? 'lazy',
        decoding: node.properties.decoding ?? 'async',
      };
    });
  };
}
