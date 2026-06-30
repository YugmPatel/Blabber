import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { deregisterMobilePushDevice, getMobilePushStatus, registerMobilePushDevice, verifyMobilePushDevice } from '@/api/blabber';
import { getInstallId } from '@/storage/secure-store';

export type MobilePushState = 'not_enabled' | 'verifying_device' | 'enabled' | 'unavailable';

export async function readMobilePushStatus(): Promise<MobilePushState> {
  const installationId = await getInstallId();
  const status = await getMobilePushStatus(installationId);
  return status.device.state;
}

export async function enableMobileNotifications(): Promise<MobilePushState> {
  const existing = await Notifications.getPermissionsAsync();
  const permission = existing.granted ? existing : await Notifications.requestPermissionsAsync();
  if (!permission.granted) return 'not_enabled';
  const token = await Notifications.getExpoPushTokenAsync();
  const installationId = await getInstallId();
  const registered = await registerMobilePushDevice({
    token: token.data,
    installationId,
    platform: Platform.OS === 'ios' ? 'ios' : 'android',
  });
  return registered.device.state;
}

export async function confirmMobileNotificationDevice(challenge: string): Promise<MobilePushState> {
  const installationId = await getInstallId();
  const result = await verifyMobilePushDevice({ installationId, challenge });
  return result.device.state;
}

export async function disableMobileNotifications() {
  const installationId = await getInstallId();
  await deregisterMobilePushDevice(installationId);
  return 'not_enabled' as const;
}
