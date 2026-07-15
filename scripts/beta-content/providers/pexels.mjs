// Pexels provider — primary source for photos and videos (see task content
// mix). Parsing is factored into pure functions (parsePhotosResponse /
// parseVideosResponse) so tests can feed in a fixture JSON body without ever
// calling the real API — the fetch-performing functions below are thin
// wrappers around those.

const BASE_URL = 'https://api.pexels.com';

export function parsePhotosResponse(json) {
  const photos = Array.isArray(json?.photos) ? json.photos : [];
  return photos.map((photo) => ({
    provider: 'pexels',
    kind: 'photo',
    sourceAssetId: String(photo.id),
    width: Number(photo.width) || 0,
    height: Number(photo.height) || 0,
    downloadUrl: photo.src?.large2x || photo.src?.large || photo.src?.original || null,
    previewUrl: photo.src?.medium || photo.src?.small || null,
    photographer: String(photo.photographer || '').slice(0, 120) || null,
    providerPageUrl: photo.url || null,
    alt: photo.alt || null,
  }));
}

export function parseVideosResponse(json) {
  const videos = Array.isArray(json?.videos) ? json.videos : [];
  return videos.map((video) => {
    const file = pickBestVideoFile(video.video_files);
    return {
      provider: 'pexels',
      kind: 'video',
      sourceAssetId: String(video.id),
      width: Number(file?.width || video.width) || 0,
      height: Number(file?.height || video.height) || 0,
      durationSeconds: Number(video.duration) || 0,
      downloadUrl: file?.link || null,
      previewUrl: video.video_pictures?.[0]?.picture || null,
      photographer: String(video.user?.name || '').slice(0, 120) || null,
      providerPageUrl: video.url || null,
    };
  });
}

/**
 * Prefers a portrait, MP4, moderate-resolution file (good for a vertical
 * Reel) — mirrors the selection logic already proven in
 * scripts/import-pexels-demo-content.mjs's pickVideoFile.
 */
export function pickBestVideoFile(videoFiles) {
  const files = Array.isArray(videoFiles) ? videoFiles : [];
  const mp4Files = files.filter((file) => String(file.file_type || '').toLowerCase() === 'video/mp4' && file.link);
  const portrait = mp4Files
    .filter((file) => Number(file.width || 0) <= 1920 && Number(file.height || 0) <= 1920)
    .filter((file) => Number(file.height || 0) >= Number(file.width || 0))
    .sort((a, b) => {
      const target = 720 * 1280;
      const areaA = Number(a.width || 0) * Number(a.height || 0);
      const areaB = Number(b.width || 0) * Number(b.height || 0);
      return Math.abs(areaA - target) - Math.abs(areaB - target);
    })[0];
  return portrait || mp4Files[0] || null;
}

async function pexelsRequest(path, params, { apiKey, fetchImpl = fetch }) {
  const url = new URL(`${BASE_URL}/${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  const response = await fetchImpl(url, { headers: { Authorization: apiKey } });
  if (!response.ok) throw new Error(`pexels_${path.replace(/\W/g, '_')}_http_${response.status}`);
  return response.json();
}

export async function searchPhotos({ query, page = 1, perPage = 12, orientation = 'landscape', apiKey, fetchImpl }) {
  const json = await pexelsRequest('v1/search', { query, page, per_page: perPage, orientation, locale: 'en-US' }, { apiKey, fetchImpl });
  return parsePhotosResponse(json);
}

export async function searchVideos({ query, page = 1, perPage = 8, orientation = 'portrait', apiKey, fetchImpl }) {
  const json = await pexelsRequest('videos/search', { query, page, per_page: perPage, orientation, locale: 'en-US' }, { apiKey, fetchImpl });
  return parseVideosResponse(json);
}
