import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';

export interface ChatThemeSettings {
  bubbleColor: string | null;
  wallpaper: string | null;
  solidColor: string | null;
}

const DEFAULT_THEME: ChatThemeSettings = {
  bubbleColor: null,
  wallpaper: null,
  solidColor: null,
};

function storageKey(userId?: string, chatId?: string) {
  return userId && chatId ? `blabber-chat-theme:v1:${userId}:${chatId}` : null;
}

function readTheme(key: string | null): ChatThemeSettings {
  if (!key || typeof window === 'undefined') return DEFAULT_THEME;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) || 'null');
    return {
      bubbleColor: typeof parsed?.bubbleColor === 'string' ? parsed.bubbleColor : null,
      wallpaper: typeof parsed?.wallpaper === 'string' ? parsed.wallpaper : null,
      solidColor: typeof parsed?.solidColor === 'string' ? parsed.solidColor : null,
    };
  } catch {
    return DEFAULT_THEME;
  }
}

export function useChatTheme(userId?: string, chatId?: string) {
  const key = useMemo(() => storageKey(userId, chatId), [chatId, userId]);
  const [theme, setThemeState] = useState<ChatThemeSettings>(() => readTheme(key));

  useEffect(() => {
    setThemeState(readTheme(key));
  }, [key]);

  const setTheme = useCallback(
    (next: ChatThemeSettings) => {
      setThemeState(next);
      if (!key || typeof window === 'undefined') return;
      if (!next.bubbleColor && !next.wallpaper && !next.solidColor) {
        window.localStorage.removeItem(key);
        return;
      }
      window.localStorage.setItem(key, JSON.stringify(next));
    },
    [key]
  );

  const resetTheme = useCallback(() => setTheme(DEFAULT_THEME), [setTheme]);

  return { theme, setTheme, resetTheme };
}

export function chatThemeScrollStyle(theme: ChatThemeSettings): CSSProperties | undefined {
  if (!theme.wallpaper && !theme.solidColor) return undefined;
  const baseColor = theme.solidColor || '#f8faf9';
  const wallpaper = theme.wallpaper;
  if (!wallpaper) return { backgroundColor: baseColor };
  const pattern =
    wallpaper === 'dots'
      ? 'radial-gradient(circle, rgba(15, 118, 110, 0.16) 1px, transparent 1px)'
      : wallpaper === 'grid'
        ? 'linear-gradient(rgba(15, 118, 110, 0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(15, 118, 110, 0.1) 1px, transparent 1px)'
        : wallpaper === 'diagonal'
          ? 'repeating-linear-gradient(135deg, rgba(15, 118, 110, 0.1), rgba(15, 118, 110, 0.1) 1px, transparent 1px, transparent 12px)'
          : '';
  return {
    backgroundColor: baseColor,
    backgroundImage: pattern || undefined,
    backgroundSize: wallpaper === 'dots' || wallpaper === 'grid' ? '22px 22px' : undefined,
  };
}

export function outgoingBubbleStyle(theme: ChatThemeSettings): CSSProperties | undefined {
  return theme.bubbleColor
    ? {
        backgroundColor: theme.bubbleColor,
        borderColor: theme.bubbleColor,
        color: '#0f172a',
      }
    : undefined;
}
