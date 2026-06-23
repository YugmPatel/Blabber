import net from 'node:net';
import tls from 'node:tls';
import { logger } from '@repo/utils';

interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

interface SafeSmtpError {
  category: string;
  code?: string | number;
  command?: string;
  retryable: boolean;
}

function smtpConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_FROM);
}

function readLine(socket: net.Socket): Promise<string> {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      if (/\r?\n$/.test(buffer) && !/^\d{3}-/m.test(buffer.split(/\r?\n/).slice(-2, -1)[0] || '')) {
        socket.off('data', onData);
        resolve(buffer);
      }
    };
    socket.once('error', reject);
    socket.on('data', onData);
  });
}

function waitForSecureConnect(socket: tls.TLSSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    if (socket.authorized || socket.encrypted) {
      resolve();
      return;
    }

    socket.once('secureConnect', resolve);
    socket.once('error', reject);
  });
}

async function sendCommand(
  socket: net.Socket,
  command: string,
  expected: number[],
  safeCommandName?: string
) {
  socket.write(`${command}\r\n`);
  const response = await readLine(socket);
  const code = Number(response.slice(0, 3));
  if (!expected.includes(code)) {
    const error = new Error(`SMTP command failed (${code})`) as Error & {
      smtpCode?: number;
      smtpCommand?: string;
      smtpResponseCategory?: string;
    };
    error.smtpCode = code;
    error.smtpCommand = safeCommandName || command.split(' ')[0];
    error.smtpResponseCategory = response.slice(4).split(/\s+/).slice(0, 2).join(' ');
    throw error;
  }
  return response;
}

function escapeMessage(text: string) {
  return text.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..');
}

function getEnvelopeAddress(from: string) {
  const match = from.match(/<([^<>@\s]+@[^<>\s]+)>/);
  return match?.[1] || from.trim();
}

function sanitizeSmtpError(error: unknown): SafeSmtpError {
  const smtpError = error as {
    code?: string;
    command?: string;
    smtpCode?: number;
    smtpCommand?: string;
  };
  const code = smtpError.smtpCode || smtpError.code;
  const command = smtpError.smtpCommand || smtpError.command;

  let category = 'smtp_unknown_error';
  if (code === 'ETIMEDOUT' || code === 'ECONNRESET' || code === 'ENOTFOUND') {
    category = 'smtp_transport_error';
  } else if (code === 535) {
    category = 'smtp_authentication_rejected';
  } else if (typeof code === 'number' && code >= 500) {
    category = 'smtp_permanent_rejection';
  } else if (typeof code === 'number' && code >= 400) {
    category = 'smtp_temporary_rejection';
  }

  const retryable =
    category === 'smtp_transport_error' ||
    category === 'smtp_temporary_rejection' ||
    (typeof code === 'number' && code >= 400 && code < 500);

  return {
    category,
    code,
    command,
    retryable,
  };
}

export async function verifyEmailTransport(): Promise<{ ok: boolean; error?: SafeSmtpError }> {
  if (!smtpConfigured()) {
    return {
      ok: false,
      error: {
        category: 'smtp_not_configured',
        retryable: false,
      },
    };
  }

  const host = process.env.SMTP_HOST!;
  const port = Number(process.env.SMTP_PORT || '587');
  const secure = process.env.SMTP_SECURE === 'true' || port === 465;
  const username = process.env.SMTP_USER;
  const password = process.env.SMTP_PASS;
  const appName = process.env.APP_NAME || 'Blabber';

  let socket: net.Socket = secure
    ? tls.connect(port, host, { servername: host })
    : net.connect(port, host);

  try {
    if (secure) {
      await waitForSecureConnect(socket as tls.TLSSocket);
    }

    await readLine(socket);
    await sendCommand(socket, `EHLO ${appName}`, [250]);

    if (!secure && process.env.SMTP_STARTTLS !== 'false') {
      await sendCommand(socket, 'STARTTLS', [220]);
      socket = tls.connect({ socket, servername: host });
      await waitForSecureConnect(socket as tls.TLSSocket);
      await sendCommand(socket, `EHLO ${appName}`, [250]);
    }

    if (username && password) {
      await sendCommand(socket, 'AUTH LOGIN', [334]);
      await sendCommand(socket, Buffer.from(username).toString('base64'), [334], 'AUTH_USER');
      await sendCommand(socket, Buffer.from(password).toString('base64'), [235], 'AUTH_PASS');
    }

    await sendCommand(socket, 'QUIT', [221]);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: sanitizeSmtpError(error),
    };
  } finally {
    socket.end();
  }
}

export async function sendEmail(message: EmailMessage): Promise<boolean> {
  if (!smtpConfigured()) {
    logger.warn(
      {
        event: 'password_reset.email_send_failed',
        category: 'smtp_not_configured',
        retryable: false,
      },
      'Password reset email was not sent'
    );
    return false;
  }

  const host = process.env.SMTP_HOST!;
  const port = Number(process.env.SMTP_PORT || '587');
  const secure = process.env.SMTP_SECURE === 'true' || port === 465;
  const from = process.env.SMTP_FROM!;
  const envelopeFrom = getEnvelopeAddress(from);
  const username = process.env.SMTP_USER;
  const password = process.env.SMTP_PASS;
  const appName = process.env.APP_NAME || 'Blabber';

  let socket: net.Socket = secure
    ? tls.connect(port, host, { servername: host })
    : net.connect(port, host);

  try {
    if (secure) {
      await waitForSecureConnect(socket as tls.TLSSocket);
    }

    await readLine(socket);
    await sendCommand(socket, `EHLO ${appName}`, [250]);

    if (!secure && process.env.SMTP_STARTTLS !== 'false') {
      await sendCommand(socket, 'STARTTLS', [220]);
      socket = tls.connect({ socket, servername: host });
      await waitForSecureConnect(socket as tls.TLSSocket);
      await sendCommand(socket, `EHLO ${appName}`, [250]);
    }

    if (username && password) {
      await sendCommand(socket, 'AUTH LOGIN', [334]);
      await sendCommand(socket, Buffer.from(username).toString('base64'), [334], 'AUTH_USER');
      await sendCommand(socket, Buffer.from(password).toString('base64'), [235], 'AUTH_PASS');
    }

    await sendCommand(socket, `MAIL FROM:<${envelopeFrom}>`, [250]);
    await sendCommand(socket, `RCPT TO:<${message.to}>`, [250, 251]);
    await sendCommand(socket, 'DATA', [354]);

    const headers = [
      `From: ${from}`,
      `To: ${message.to}`,
      `Subject: ${message.subject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
    ].join('\r\n');

    socket.write(`${headers}\r\n\r\n${escapeMessage(message.text)}\r\n.\r\n`);
    const dataResponse = await readLine(socket);
    const dataResponseCode = Number(dataResponse.slice(0, 3));
    if (dataResponseCode < 200 || dataResponseCode >= 300) {
      const error = new Error(`SMTP command failed (${dataResponseCode})`) as Error & {
        smtpCode?: number;
        smtpCommand?: string;
      };
      error.smtpCode = dataResponseCode;
      error.smtpCommand = 'DATA';
      throw error;
    }

    await sendCommand(socket, 'QUIT', [221]);
    return true;
  } catch (error) {
    logger.error(
      {
        event: 'password_reset.email_send_failed',
        ...sanitizeSmtpError(error),
      },
      'Password reset email failed'
    );
    return false;
  } finally {
    socket.end();
  }
}

export async function sendPasswordResetEmail(email: string, token: string): Promise<boolean> {
  const baseUrl = process.env.APP_BASE_URL || process.env.FRONTEND_URL;
  if (!baseUrl) {
    logger.warn(
      {
        event: 'password_reset.email_send_failed',
        category: 'app_base_url_missing',
        retryable: false,
      },
      'Password reset email was not sent'
    );
    return false;
  }

  const resetUrl = `${baseUrl.replace(/\/$/, '')}/reset-password?token=${encodeURIComponent(token)}`;

  return sendEmail({
    to: email,
    subject: 'Reset your Blabber password',
    text: [
      'A password reset was requested for your Blabber account.',
      '',
      `Open this link to reset your password: ${resetUrl}`,
      '',
      'This link expires in 1 hour. If you did not request this, you can ignore this email.',
    ].join('\n'),
  });
}
