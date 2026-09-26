// Public assets are served from Vercel Blob. Keep the mapping in one place so
// the catalog can continue to use its existing logical paths.
export const BLOB_BASE = 'https://dbu9btjyfhr28qsx.public.blob.vercel-storage.com';

function fileName(path) {
  return path.split('/').pop().replace(/\.[^.]+$/, '');
}

/**
 * Convert a repository asset path to the corresponding public Blob URL.
 * Catalog entries remain readable in source control and do not contain a
 * second copy of the public URL for every card.
 */
export function assetUrl(path) {
  if (!path) return path;
  if (/^https?:\/\//i.test(path)) return path;
  const normalized = String(path).replace(/^\.\//, '');
  if (normalized.startsWith('assets/card-art-v2/')) {
    return `${BLOB_BASE}/cards/${fileName(normalized)}-converted.webp`;
  }
  if (normalized.startsWith('assets/card-ui/')) {
    return `${BLOB_BASE}/card-ui/${fileName(normalized)}-converted.webp`;
  }
  return new URL(path, import.meta.url).href;
}
