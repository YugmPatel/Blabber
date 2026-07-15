// Pixabay provider — fallback source for photos/videos when Pexels doesn't
// have enough good candidates for a query (see fallback chain in
// content-plan.mjs / db-writer.mjs). Same parse/fetch separation as
// pexels.mjs for testability.

const BASE_URL = 'https://pixabay.com/api';

export function parsePhotosResponse(json) {
  const hits = Array.isArray(json?.hits) ? json.hits : [];
  return hits.map((hit) => ({
    provider: 'pixabay',
    kind: 'photo',
    sourceAssetId: String(hit.id),
    width: Number(hit.imageWidth) || 0,
    height: Number(hit.imageHeight) || 0,
    downloadUrl: hit.largeImageURL || hit.webformatURL || null,
    previewUrl: hit.webformatURL || null,
    photographer: String(hit.user || '').slice(0, 120) || null,
    providerPageUrl: hit.pageURL || null,
    tags: hit.tags || null,
  }));
}

export function parseVideosResponse(json) {
  const hits = Array.isArray(json?.hits) ? json.hits : [];
  return hits.map((hit) => {
    const file = pickBestVideoFile(hit.videos);
    return {
      provider: 'pixabay',
      kind: 'video',
      sourceAssetId: String(hit.id),
      width: Number(file?.width) || 0,
      height: Number(file?.height) || 0,
      durationSeconds: Number(hit.duration) || 0,
      downloadUrl: file?.url || null,
      previewUrl: hit.videos?.tiny?.url || null,
      photographer: String(hit.user || '').slice(0, 120) || null,
      providerPageUrl: hit.pageURL || null,
      tags: hit.tags || null,
    };
  });
}

/**
 * Pixabay video hits expose a fixed set of named quality tiers rather than a
 * files array. Prefer 'medium' as a reasonable size/quality tradeoff for a
 * short Reel; fall back to whatever tier is actually present.
 */
export function pickBestVideoFile(videos) {
  if (!videos || typeof videos !== 'object') return null;
  return videos.medium || videos.large || videos.small || videos.tiny || null;
}

async function pixabayRequest(path, params, { apiKey, fetchImpl = fetch }) {
  const url = new URL(`${BASE_URL}${path}`);
  url.searchParams.set('key', apiKey);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`pixabay_${path.replace(/\W/g, '_')}_http_${response.status}`);
  return response.json();
}

export async function searchPhotos({ query, page = 1, perPage = 12, apiKey, fetchImpl }) {
  const json = await pixabayRequest('/', { q: query, image_type: 'photo', page, per_page: perPage, min_width: 1080, safesearch: 'true' }, { apiKey, fetchImpl });
  return parsePhotosResponse(json);
}

export async function searchVideos({ query, page = 1, perPage = 8, apiKey, fetchImpl }) {
  const json = await pixabayRequest('/videos/', { q: query, page, per_page: perPage, safesearch: 'true' }, { apiKey, fetchImpl });
  return parseVideosResponse(json);
}
