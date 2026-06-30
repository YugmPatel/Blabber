import { useColorScheme } from 'react-native';

export const light = {
  bg: '#f8fafc',
  surface: '#ffffff',
  text: '#0f172a',
  muted: '#64748b',
  border: '#e2e8f0',
  primary: '#0f766e',
  danger: '#b91c1c',
};

export const dark = {
  bg: '#020617',
  surface: '#0f172a',
  text: '#f8fafc',
  muted: '#94a3b8',
  border: '#1e293b',
  primary: '#2dd4bf',
  danger: '#fca5a5',
};

export function useTheme() {
  return useColorScheme() === 'dark' ? dark : light;
}
