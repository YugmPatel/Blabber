import { uploadBinaryToUrl } from '@/api/client';
import { presignImageMedia } from '@/api/blabber';
import { pickPhotoForFutureUpload } from './picker';
import { rememberTransientUploadReferences, trackUploadController, untrackUploadController } from './upload-session';

export type MobileImageUploadState =
  | 'idle'
  | 'selecting_photo'
  | 'preparing_upload'
  | 'uploading'
  | 'processing'
  | 'ready'
  | 'could_not_upload'
  | 'cancelled';

export type UploadedMobileImage = {
  mediaId: string;
  status: 'approved' | 'pending' | 'rejected';
};

export async function uploadPickedImageForPublishing(onState?: (state: MobileImageUploadState) => void): Promise<UploadedMobileImage | null> {
  onState?.('selecting_photo');
  const picked = await pickPhotoForFutureUpload();
  if (!picked) {
    onState?.('cancelled');
    return null;
  }
  rememberTransientUploadReferences({ pickedUri: picked.uri });
  const contentType = picked.type || 'image/jpeg';
  const fileName = picked.fileName || 'mobile-photo.jpg';

  onState?.('preparing_upload');
  const presign = await presignImageMedia({ fileName, contentType, fileSize: picked.fileSize });
  rememberTransientUploadReferences({ uploadUrl: presign.uploadUrl, mediaId: presign.mediaId });

  const controller = new AbortController();
  trackUploadController(controller);
  try {
    onState?.('uploading');
    const local = await fetch(picked.uri);
    const blob = await local.blob();
    onState?.('processing');
    const result = await uploadBinaryToUrl(presign.uploadUrl, blob, contentType, controller.signal);
    onState?.('ready');
    return { mediaId: result.mediaId, status: result.status };
  } catch (error) {
    onState?.(controller.signal.aborted ? 'cancelled' : 'could_not_upload');
    throw error;
  } finally {
    untrackUploadController(controller);
    rememberTransientUploadReferences({ pickedUri: null, uploadUrl: null, mediaId: null });
  }
}
