import { redact } from './redact';

export function mobileLog(message: string, data?: unknown) {
  if (process.env.NODE_ENV === 'production') return;
  if (typeof data === 'undefined') {
    console.info(message);
    return;
  }
  console.info(message, redact(data));
}

export function mobileWarn(message: string, data?: unknown) {
  if (process.env.NODE_ENV === 'production') return;
  console.warn(message, redact(data));
}
