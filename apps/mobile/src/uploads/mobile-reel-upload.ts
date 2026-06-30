import { deleteReel, getReelStatus, initiateReelUpload, publishReel } from '@/api/blabber';
import { uploadBinaryToUrl } from '@/api/client';
import { pickVideoForFutureUpload } from './picker';
import { rememberTransientUploadReferences, trackUploadController, untrackUploadController } from './upload-session';

export type MobileReelUploadState =
  | 'idle'
  | 'selecting_video'
  | 'preparing_upload'
  | 'uploading'
  | 'upload_interrupted'
  | 'scanning'
  | 'processing'
  | 'ready'
  | 'publishing'
  | 'published'
  | 'cancelled'
  | 'unavailable';

export type MobileReelDraft = {
  reelId: string;
  status: string;
};

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollReady(reelId: string, onState?: (state: MobileReelUploadState) => void) {
  for (let attempt = 0; attempt < 18; attempt += 1) {
    const status = await getReelStatus(reelId);
    const processingStatus = status.reel?.processingStatus || status.reel?.status;
    if (processingStatus === 'ready') {
      onState?.('ready');
      return status.reel;
    }
    if (processingStatus === 'rejected' || processingStatus === 'failed') {
      onState?.('unavailable');
      throw new Error('Reel is unavailable.');
    }
    onState?.(processingStatus === 'scanning' ? 'scanning' : 'processing');
    await wait(1500);
  }
  onState?.('processing');
  return { id: reelId, processingStatus: 'processing' };
}

export async function uploadPickedReelForPublishing(onState?: (state: MobileReelUploadState) => void): Promise<MobileReelDraft | null> {
  onState?.('selecting_video');
  const picked = await pickVideoForFutureUpload();
  if (!picked) {
    onState?.('cancelled');
    return null;
  }
  rememberTransientUploadReferences({ pickedUri: picked.uri });

  const fileType = picked.type || 'video/mp4';
  const fileName = picked.fileName || 'mobile-reel.mp4';
  const fileSize = picked.fileSize || 1;
  const controller = new AbortController();
  trackUploadController(controller);
  let reelId: string | null = null;

  try {
    onState?.('preparing_upload');
    const init = await initiateReelUpload({ fileName, fileType, fileSize });
    reelId = init.reelId;
    rememberTransientUploadReferences({ uploadUrl: init.uploadUrl, mediaId: reelId });

    onState?.('uploading');
    const local = await fetch(picked.uri);
    const blob = await local.blob();
    await uploadBinaryToUrl(init.uploadUrl, blob, fileType, controller.signal);
    const reel = await pollReady(reelId, onState);
    return { reelId, status: reel.processingStatus || 'ready' };
  } catch (error) {
    onState?.(controller.signal.aborted ? 'cancelled' : 'upload_interrupted');
    throw error;
  } finally {
    untrackUploadController(controller);
    rememberTransientUploadReferences({ pickedUri: null, uploadUrl: null, mediaId: null });
  }
}

export async function cancelMobileReelUpload(reelId?: string | null) {
  if (reelId) await deleteReel(reelId).catch(() => undefined);
  rememberTransientUploadReferences({ pickedUri: null, uploadUrl: null, mediaId: null });
}

export async function publishMobileReel(input: { reelId: string; caption?: string; visibility: 'public' | 'followers'; topicIds?: string[] }, onState?: (state: MobileReelUploadState) => void) {
  onState?.('publishing');
  const result = await publishReel(input);
  onState?.('published');
  return result.reel;
}
