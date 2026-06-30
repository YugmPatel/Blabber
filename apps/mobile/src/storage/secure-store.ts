import * as SecureStore from 'expo-secure-store';

const REFRESH_KEY = 'blabber.mobile.refreshCredential';
const INSTALL_KEY = 'blabber.mobile.installId';

export async function getRefreshCredential() {
  return SecureStore.getItemAsync(REFRESH_KEY);
}

export async function setRefreshCredential(value: string) {
  await SecureStore.setItemAsync(REFRESH_KEY, value, {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  });
}

export async function clearRefreshCredential() {
  await SecureStore.deleteItemAsync(REFRESH_KEY);
}

export async function getInstallId() {
  const existing = await SecureStore.getItemAsync(INSTALL_KEY);
  if (existing) return existing;
  const value = `mobile-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  await SecureStore.setItemAsync(INSTALL_KEY, value, {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  });
  return value;
}
