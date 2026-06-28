import net from 'node:net';

export type ScanMode = 'clamav' | 'mock' | 'disabled';
export type ScanResult = { ok: true; mode: ScanMode } | { ok: false; mode: ScanMode; category: 'infected' | 'scanner_unavailable' };

export function scannerMode(): ScanMode {
  const mode = (process.env.MEDIA_SCANNER_MODE || (process.env.NODE_ENV === 'production' ? 'clamav' : 'mock')).toLowerCase();
  if (mode === 'clamav' || mode === 'mock' || mode === 'disabled') return mode;
  return process.env.NODE_ENV === 'production' ? 'clamav' : 'mock';
}

export async function scanBuffer(buffer: Buffer): Promise<ScanResult> {
  const mode = scannerMode();
  if (mode === 'disabled') return { ok: true, mode };
  if (mode === 'mock') {
    return buffer.includes(Buffer.from('EICAR')) || buffer.includes(Buffer.from('BLABBER_MOCK_MALWARE'))
      ? { ok: false, mode, category: 'infected' }
      : { ok: true, mode };
  }
  return scanWithClamav(buffer);
}

function scanWithClamav(buffer: Buffer): Promise<ScanResult> {
  const host = process.env.CLAMAV_HOST || 'clamav';
  const port = Number(process.env.CLAMAV_PORT || 3310);
  const timeoutMs = Number(process.env.CLAMAV_TIMEOUT_MS || 5000);

  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const chunks: Buffer[] = [];
    let settled = false;
    const settle = (result: ScanResult) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(timeoutMs, () => settle({ ok: false, mode: 'clamav', category: 'scanner_unavailable' }));
    socket.on('error', () => settle({ ok: false, mode: 'clamav', category: 'scanner_unavailable' }));
    socket.on('data', (chunk) => chunks.push(chunk));
    socket.on('end', () => {
      const response = Buffer.concat(chunks).toString('utf8');
      if (response.includes('OK')) settle({ ok: true, mode: 'clamav' });
      else if (response.includes('FOUND')) settle({ ok: false, mode: 'clamav', category: 'infected' });
      else settle({ ok: false, mode: 'clamav', category: 'scanner_unavailable' });
    });
    socket.on('connect', () => {
      socket.write('zINSTREAM\0');
      for (let offset = 0; offset < buffer.length; offset += 8192) {
        const chunk = buffer.subarray(offset, offset + 8192);
        const size = Buffer.alloc(4);
        size.writeUInt32BE(chunk.length, 0);
        socket.write(size);
        socket.write(chunk);
      }
      socket.write(Buffer.alloc(4));
    });
  });
}
