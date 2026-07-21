import net from 'node:net';
import tls from 'node:tls';
import type { ChatActionItem } from '@repo/types';
import { logger } from '@repo/utils';

export type DigestGroupKey = 'overdue' | 'today' | 'upcoming' | 'none';

export interface DigestActionItem extends ChatActionItem {
  chatTitle?: string;
  chatType?: 'direct' | 'group';
  chatEndedAt?: string;
}

export interface GroupedDigestActions {
  overdue: DigestActionItem[];
  today: DigestActionItem[];
  upcoming: DigestActionItem[];
  none: DigestActionItem[];
}

export interface ActionsDigestEmail {
  subject: string;
  html: string;
  text: string;
  funnyLine: string;
  grouped: GroupedDigestActions;
  count: number;
}

interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

const FUNNY_LINES = [
  'They are not yelling. They are just... patiently staring.',
  'One of these might be due soon, so it has officially entered main-character mode.',
  'No pressure, but your future self has opened a support ticket.',
  "A few tasks are still vibing in your list. Let's reduce the population.",
  'Completing even one of these will unlock a tiny dopamine achievement.',
  'The group chat created these. Unfortunately, now they live here.',
];

function smtpConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_FROM);
}

function appBaseUrl() {
  return (process.env.APP_BASE_URL || process.env.FRONTEND_URL || 'https://app.blabber.dev').replace(/\/+$/, '');
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

async function sendCommand(socket: net.Socket, command: string, expected: number[], safeCommandName?: string) {
  socket.write(`${command}\r\n`);
  const response = await readLine(socket);
  const code = Number(response.slice(0, 3));
  if (!expected.includes(code)) {
    const error = new Error(`SMTP command failed (${code})`) as Error & { smtpCode?: number; smtpCommand?: string };
    error.smtpCode = code;
    error.smtpCommand = safeCommandName || command.split(' ')[0];
    throw error;
  }
}

function escapeSmtpBody(text: string) {
  return text.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..');
}

function getEnvelopeAddress(from: string) {
  const match = from.match(/<([^<>@\s]+@[^<>\s]+)>/);
  return match?.[1] || from.trim();
}

function boundary() {
  return `blabber-actions-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export async function sendActionsDigestEmail(message: EmailMessage): Promise<boolean> {
  if (!smtpConfigured()) {
    logger.warn(
      { event: 'actions_digest.email_send_failed', category: 'smtp_not_configured', retryable: false },
      'Actions digest email was not sent'
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
  const multipartBoundary = boundary();

  let socket: net.Socket = secure ? tls.connect(port, host, { servername: host }) : net.connect(port, host);

  try {
    if (secure) await waitForSecureConnect(socket as tls.TLSSocket);
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
      `Content-Type: multipart/alternative; boundary="${multipartBoundary}"`,
    ].join('\r\n');

    const body = [
      `--${multipartBoundary}`,
      'Content-Type: text/plain; charset=utf-8',
      '',
      message.text,
      `--${multipartBoundary}`,
      'Content-Type: text/html; charset=utf-8',
      '',
      message.html,
      `--${multipartBoundary}--`,
      '',
    ].join('\r\n');

    socket.write(`${headers}\r\n\r\n${escapeSmtpBody(body)}\r\n.\r\n`);
    const dataResponse = await readLine(socket);
    const dataResponseCode = Number(dataResponse.slice(0, 3));
    if (dataResponseCode < 200 || dataResponseCode >= 300) {
      const error = new Error(`SMTP command failed (${dataResponseCode})`) as Error & { smtpCode?: number; smtpCommand?: string };
      error.smtpCode = dataResponseCode;
      error.smtpCommand = 'DATA';
      throw error;
    }
    await sendCommand(socket, 'QUIT', [221]);
    return true;
  } catch (error) {
    logger.error(
      { event: 'actions_digest.email_send_failed', command: (error as { smtpCommand?: string }).smtpCommand },
      'Actions digest email failed'
    );
    return false;
  } finally {
    socket.end();
  }
}

function dueDateFor(action: DigestActionItem): Date | null {
  const raw = action.dueAt || action.dueDate;
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function daysBetween(a: Date, b: Date) {
  return Math.round((startOfDay(a).getTime() - startOfDay(b).getTime()) / (24 * 60 * 60 * 1000));
}

function groupFor(action: DigestActionItem, now: Date): DigestGroupKey {
  const due = dueDateFor(action);
  if (!due) return 'none';
  const delta = daysBetween(due, now);
  if (delta < 0) return 'overdue';
  if (delta === 0) return 'today';
  return 'upcoming';
}

function normalizeStatus(status: string) {
  if (status === 'in_progress') return 'in_progress';
  if (status === 'completed' || status === 'dismissed') return 'completed';
  return 'open';
}

export function remainingDigestActions(actions: DigestActionItem[], now = new Date()): DigestActionItem[] {
  const seen = new Set<string>();
  return actions
    .filter((action) => {
      const status = normalizeStatus(action.status);
      if (status === 'completed') return false;
      if (action.deletedAt) return false;
      if (action.chatEndedAt) return false;
      if (action.metadata?.planStatus === 'cancelled' || action.metadata?.planStatus === 'expired') return false;
      const key = action.id || `${action.chatId}:${action.title}:${action.assignedTo?.userId || ''}:${action.createdAt || ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => {
      const groupOrder: Record<DigestGroupKey, number> = { overdue: 0, today: 1, upcoming: 2, none: 3 };
      const groupDelta = groupOrder[groupFor(a, now)] - groupOrder[groupFor(b, now)];
      if (groupDelta !== 0) return groupDelta;
      const aDue = dueDateFor(a)?.getTime() ?? Number.MAX_SAFE_INTEGER;
      const bDue = dueDateFor(b)?.getTime() ?? Number.MAX_SAFE_INTEGER;
      if (aDue !== bDue) return aDue - bDue;
      const titleDelta = a.title.localeCompare(b.title);
      if (titleDelta !== 0) return titleDelta;
      return String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
    });
}

export function groupDigestActions(actions: DigestActionItem[], now = new Date()): GroupedDigestActions {
  const grouped: GroupedDigestActions = { overdue: [], today: [], upcoming: [], none: [] };
  for (const action of actions) grouped[groupFor(action, now)].push(action);
  return grouped;
}

function firstName(name?: string, email?: string) {
  const value = (name || email?.split('@')[0] || 'there').trim();
  return value.split(/\s+/)[0] || 'there';
}

function subjectFor(count: number) {
  if (count > 0) return `You have ${count} open Actions in Blabber`;
  return 'Your Actions are waiting';
}

function funnyLineFor(count: number) {
  return FUNNY_LINES[count % FUNNY_LINES.length];
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function dueLabel(action: DigestActionItem, now = new Date()) {
  const due = dueDateFor(action);
  if (!due) return 'No due date';
  const delta = daysBetween(due, now);
  if (delta === -1) return 'Yesterday';
  if (delta < 0) return 'Overdue';
  if (delta === 0) return 'Today';
  if (delta === 1) return 'Tomorrow';
  const options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  if (due.getFullYear() !== now.getFullYear()) options.year = 'numeric';
  return due.toLocaleDateString('en-US', options);
}

function statusLabel(status: string) {
  return normalizeStatus(status) === 'in_progress' ? 'In Progress' : 'Open';
}

function description(action: DigestActionItem) {
  const text = action.description?.trim();
  if (!text) return '';
  return text.length > 140 ? `${text.slice(0, 137)}...` : text;
}

function textGroup(title: string, actions: DigestActionItem[], startIndex: number, now: Date) {
  if (actions.length === 0) return { text: '', nextIndex: startIndex };
  let index = startIndex;
  const lines = [title];
  for (const action of actions) {
    lines.push(`${index}. ${action.title}`);
    lines.push(`   Due: ${dueLabel(action, now)}`);
    lines.push(`   Chat: ${action.chatTitle || 'My Actions'}`);
    if (statusLabel(action.status) !== 'Open') lines.push(`   Status: ${statusLabel(action.status)}`);
    const extra = description(action);
    if (extra) lines.push(`   Note: ${extra}`);
    index += 1;
  }
  return { text: lines.join('\n'), nextIndex: index };
}

function htmlGroup(title: string, actions: DigestActionItem[], now: Date) {
  if (actions.length === 0) return '';
  const items = actions.map((action) => {
    const extra = description(action);
    return `
      <li style="margin: 0 0 14px 0;">
        <div style="font-weight: 700; color: #0f172a;">${escapeHtml(action.title)}</div>
        <div style="margin-top: 4px; color: #475569;">Due: ${escapeHtml(dueLabel(action, now))} | Chat: ${escapeHtml(action.chatTitle || 'My Actions')} | Status: ${escapeHtml(statusLabel(action.status))}</div>
        ${extra ? `<div style="margin-top: 4px; color: #64748b;">${escapeHtml(extra)}</div>` : ''}
      </li>
    `;
  }).join('');
  return `
    <section style="margin-top: 22px;">
      <h2 style="margin: 0 0 10px 0; color: #0f766e; font-size: 16px;">${escapeHtml(title)}</h2>
      <ol style="margin: 0; padding-left: 22px;">${items}</ol>
    </section>
  `;
}

export function buildActionsDigestEmail(params: {
  userName?: string;
  userEmail?: string;
  actions: DigestActionItem[];
  now?: Date;
}): ActionsDigestEmail {
  const now = params.now || new Date();
  const actions = remainingDigestActions(params.actions, now);
  const grouped = groupDigestActions(actions, now);
  const count = actions.length;
  const funnyLine = funnyLineFor(count);
  const myActionsUrl = `${appBaseUrl()}/actions`;
  const name = firstName(params.userName, params.userEmail);
  const groupEntries: Array<[string, DigestActionItem[]]> = [
    ['Overdue', grouped.overdue],
    ['Due today', grouped.today],
    ['Upcoming', grouped.upcoming],
    ['No due date', grouped.none],
  ];

  let nextIndex = 1;
  const textGroups = groupEntries.map(([title, items]) => {
    const rendered = textGroup(title, items, nextIndex, now);
    nextIndex = rendered.nextIndex;
    return rendered.text;
  }).filter(Boolean);
  const htmlGroups = groupEntries.map(([title, items]) => htmlGroup(title, items, now)).join('');

  const text = [
    `Hi ${name},`,
    '',
    `Quick Blabber reminder: you still have ${count} open ${count === 1 ? 'Action' : 'Actions'}.`,
    '',
    funnyLine,
    '',
    "Here's what needs attention:",
    '',
    textGroups.join('\n\n'),
    '',
    'Open My Actions:',
    myActionsUrl,
    '',
    "You've got this,",
    'Blabber',
  ].join('\n');

  const html = `
    <div style="margin:0; padding:24px; background:#f8fafc; color:#0f172a; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
      <div style="max-width:640px; margin:0 auto; border:1px solid #dbe7e5; border-radius:16px; background:#ffffff; padding:28px;">
        <div style="font-size:13px; font-weight:800; letter-spacing:0.08em; text-transform:uppercase; color:#0f766e;">Blabber</div>
        <h1 style="margin:10px 0 8px 0; color:#0f172a; font-size:24px; line-height:1.25;">Your Actions are waiting</h1>
        <p style="margin:0 0 16px 0; color:#475569; font-size:15px;">Hi ${escapeHtml(name)}, quick reminder: you still have <strong>${count}</strong> open ${count === 1 ? 'Action' : 'Actions'}.</p>
        <p style="margin:0 0 20px 0; color:#334155; font-size:14px;">${escapeHtml(funnyLine)}</p>
        ${htmlGroups}
        <div style="margin-top:28px;">
          <a href="${escapeHtml(myActionsUrl)}" style="display:inline-block; background:#0d9488; color:#ffffff; text-decoration:none; border-radius:10px; padding:11px 16px; font-weight:700;">Open My Actions</a>
        </div>
        <p style="margin:24px 0 0 0; color:#64748b; font-size:14px;">You've got this,<br />Blabber</p>
      </div>
    </div>
  `.trim();

  return {
    subject: subjectFor(count),
    html,
    text,
    funnyLine,
    grouped,
    count,
  };
}
