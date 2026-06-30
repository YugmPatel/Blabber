const activeUploads = new Set<AbortController>();

let transientPickedUri: string | null = null;
let transientUploadUrl: string | null = null;
let transientMediaId: string | null = null;

export function trackUploadController(controller: AbortController) {
  activeUploads.add(controller);
}

export function untrackUploadController(controller: AbortController) {
  activeUploads.delete(controller);
}

export function rememberTransientUploadReferences(input: { pickedUri?: string | null; uploadUrl?: string | null; mediaId?: string | null }) {
  if ('pickedUri' in input) transientPickedUri = input.pickedUri || null;
  if ('uploadUrl' in input) transientUploadUrl = input.uploadUrl || null;
  if ('mediaId' in input) transientMediaId = input.mediaId || null;
}

export function clearActiveUploadReferences() {
  for (const controller of activeUploads) controller.abort();
  activeUploads.clear();
  transientPickedUri = null;
  transientUploadUrl = null;
  transientMediaId = null;
}
