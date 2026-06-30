import * as ImagePicker from 'expo-image-picker';

export type PickedMedia = {
  uri: string;
  type?: string;
  fileName?: string;
  fileSize?: number;
};

export async function pickPhotoForFutureUpload(): Promise<PickedMedia | null> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) return null;
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: false,
    quality: 0.9,
  });
  if (result.canceled) return null;
  const asset = result.assets[0];
  return { uri: asset.uri, type: asset.mimeType, fileName: asset.fileName || undefined, fileSize: asset.fileSize };
}

export async function pickVideoForFutureUpload(): Promise<PickedMedia | null> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) return null;
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['videos'],
    allowsMultipleSelection: false,
    videoMaxDuration: 90,
  });
  if (result.canceled) return null;
  const asset = result.assets[0];
  return { uri: asset.uri, type: asset.mimeType, fileName: asset.fileName || undefined, fileSize: asset.fileSize };
}
