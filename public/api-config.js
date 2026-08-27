// Public runtime configuration. This file contains no credentials: the API
// Worker owns D1/R2 bindings and Cloudflare Secrets. Keep browser requests on
// the Pages origin so mobile networks do not need to connect to workers.dev.
window.ICELIN_API_URL = '/api';
window.ICELIN_MEDIA_PUBLIC_URL = 'https://pub-2ab46ecc311a40e79c4d8c69c5f9da25.r2.dev';
// Pages proxies the Worker image route and returns cached, resized variants.
window.ICELIN_IMAGE_TRANSFORM_BASE = '/api/v1/media';
