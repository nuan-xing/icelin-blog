// Public runtime configuration. This file contains no credentials: the API
// Worker owns D1/R2 bindings and Cloudflare Secrets.
window.ICELIN_API_URL = 'https://icelin-blog-api.1256422744.workers.dev';
window.ICELIN_MEDIA_PUBLIC_URL = 'https://pub-2ab46ecc311a40e79c4d8c69c5f9da25.r2.dev';
// The Worker keeps R2 originals private to the delivery path and returns cached, resized variants.
window.ICELIN_IMAGE_TRANSFORM_BASE = 'https://icelin-blog-api.1256422744.workers.dev/v1/media';
