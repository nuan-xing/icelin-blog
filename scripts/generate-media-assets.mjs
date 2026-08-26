// The live site now reads content from D1 and media from Cloudflare R2.
// This compatibility command intentionally performs no local image generation:
// it remains only so older local workflows do not fail if they invoke `npm run media`.
console.log('D1/R2 runtime is active; no local media assets need to be generated.');
