const readEnvironment = (name) => {
  const astroEnvironment = typeof import.meta !== 'undefined' ? import.meta.env : undefined;
  const nodeEnvironment = typeof process !== 'undefined' ? process.env : undefined;
  return astroEnvironment?.[name] ?? nodeEnvironment?.[name] ?? '';
};

const trimTrailingSlashes = (value) => value.replace(/\/+$/, '');

export const R2_PUBLIC_BASE_URL = trimTrailingSlashes(readEnvironment('PUBLIC_R2_BASE_URL'));
export const IMAGE_TRANSFORM_BASE_URL = trimTrailingSlashes(
  readEnvironment('PUBLIC_IMAGE_TRANSFORM_BASE') || readEnvironment('PUBLIC_IMAGE_TRANSFORM_BASE_URL'),
);
export const RESPONSIVE_IMAGE_WIDTHS = [480, 768, 1080, 1440, 1600, 1920];

const r2HostSuffixes = ['.r2.dev', '.r2.cloudflarestorage.com'];

export function isR2MediaUrl(source) {
  if (typeof source !== 'string' || !/^https?:\/\//i.test(source)) return false;

  if (R2_PUBLIC_BASE_URL && (source === R2_PUBLIC_BASE_URL || source.startsWith(`${R2_PUBLIC_BASE_URL}/`))) {
    return true;
  }

  try {
    const hostname = new URL(source).hostname.toLowerCase();
    return r2HostSuffixes.some((suffix) => hostname.endsWith(suffix));
  } catch {
    return false;
  }
}

export function getPublicR2MediaUrl(source) {
  if (!isR2MediaUrl(source) || !R2_PUBLIC_BASE_URL) return source;

  try {
    const base = new URL(R2_PUBLIC_BASE_URL);
    const original = new URL(source);
    const basePath = base.pathname.replace(/\/+$/, '');
    return `${base.origin}${basePath}${original.pathname}${original.search}`;
  } catch {
    return source;
  }
}

export function getTransformEndpoint() {
  if (!IMAGE_TRANSFORM_BASE_URL) return '';
  return IMAGE_TRANSFORM_BASE_URL.endsWith('/cdn-cgi/image')
    ? IMAGE_TRANSFORM_BASE_URL
    : `${IMAGE_TRANSFORM_BASE_URL}/cdn-cgi/image`;
}

export function getTransformedImageUrl(source, width, quality = 88) {
  const publicSource = getPublicR2MediaUrl(source);
  const endpoint = getTransformEndpoint();
  if (!endpoint || !isR2MediaUrl(source)) return publicSource;

  const options = [`width=${width}`, `quality=${quality}`, 'format=auto', 'fit=scale-down'].join(',');
  return `${endpoint}/${options}/${publicSource}`;
}

export function getResponsiveImageSrcset(source, widths = RESPONSIVE_IMAGE_WIDTHS) {
  const endpoint = getTransformEndpoint();
  if (!endpoint || !isR2MediaUrl(source)) return '';

  return widths.map((width) => `${getTransformedImageUrl(source, width)} ${width}w`).join(', ');
}
