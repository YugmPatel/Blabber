// Unsplash provider — high-quality photo source for feed images, profile
// avatars, and topic-adjacent imagery (see task content mix: ~20% of
// photos). Unsplash has no public video search API, so this module only
// exports searchPhotos — content-plan.mjs's fallback chain accounts for
// that (Unsplash is a photo-only fallback, never consulted for reels).

const BASE_URL = 'https://api.unsplash.com';

export function parsePhotosResponse(json) {
  const results = Array.isArray(json?.results) ? json.results : [];
  return results.map((photo) => ({
    provider: 'unsplash',
    kind: 'photo',
    sourceAssetId: String(photo.id),
    width: Number(photo.width) || 0,
    height: Number(photo.height) || 0,
    downloadUrl: photo.urls?.regular || photo.urls?.full || null,
    previewUrl: photo.urls?.small || null,
    photographer: String(photo.user?.name || '').slice(0, 120) || null,
    providerPageUrl: photo.links?.html || null,
    // Unsplash's API guidelines require pinging this endpoint when a photo
    // is actually used (not just previewed) — see apply-time usage in
    // db-writer.mjs. Kept here, not called during scoring/dry-run.
    downloadTrackingUrl: photo.links?.download_location || null,
  }));
}

async function unsplashRequest(path, params, { apiKey, fetchImpl = fetch }) {
  const url = new URL(`${BASE_URL}${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  const response = await fetchImpl(url, { headers: { Authorization: `Client-ID ${apiKey}` } });
  if (!response.ok) throw new Error(`unsplash_${path.replace(/\W/g, '_')}_http_${response.status}`);
  return response.json();
}

export async function searchPhotos({ query, page = 1, perPage = 12, apiKey, fetchImpl }) {
  const json = await unsplashRequest('/search/photos', { query, page, per_page: perPage, orientation: 'landscape', content_filter: 'high' }, { apiKey, fetchImpl });
  return parsePhotosResponse(json);
}

/**
 * Fire-and-forget usage ping per Unsplash API guidelines, called only when
 * an Unsplash photo is actually selected and applied (not during scoring or
 * dry-run). Failure here must never fail the seed run.
 */
export async function trackDownload(downloadTrackingUrl, { apiKey, fetchImpl = fetch }) {
  if (!downloadTrackingUrl) return;
  try {
    await fetchImpl(downloadTrackingUrl, { headers: { Authorization: `Client-ID ${apiKey}` } });
  } catch {
    // Non-fatal — attribution ping only, never blocks seeding.
  }
}
