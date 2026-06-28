function crc32Table() {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let value = i;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[i] = value >>> 0;
  }
  return table;
}

const CRC_TABLE = crc32Table();

function crc32(buffer: Buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date: Date) {
  const year = Math.max(1980, date.getFullYear());
  const time =
    (date.getHours() << 11) |
    (date.getMinutes() << 5) |
    Math.floor(date.getSeconds() / 2);
  const day =
    ((year - 1980) << 9) |
    ((date.getMonth() + 1) << 5) |
    date.getDate();
  return { time, day };
}

function u16(value: number) {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value);
  return buffer;
}

function u32(value: number) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value >>> 0);
  return buffer;
}

export function buildZip(files: Array<{ name: string; content: unknown }>) {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  const now = new Date();
  const { time, day } = dosDateTime(now);

  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8');
    const content = Buffer.from(
      typeof file.content === 'string' ? file.content : JSON.stringify(file.content, null, 2),
      'utf8'
    );
    const crc = crc32(content);
    const localHeader = Buffer.concat([
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(0),
      u16(time),
      u16(day),
      u32(crc),
      u32(content.length),
      u32(content.length),
      u16(name.length),
      u16(0),
      name,
    ]);
    localParts.push(localHeader, content);

    centralParts.push(Buffer.concat([
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(0),
      u16(0),
      u16(time),
      u16(day),
      u32(crc),
      u32(content.length),
      u32(content.length),
      u16(name.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      name,
    ]));
    offset += localHeader.length + content.length;
  }

  const central = Buffer.concat(centralParts);
  const end = Buffer.concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(files.length),
    u16(files.length),
    u32(central.length),
    u32(offset),
    u16(0),
  ]);

  return Buffer.concat([...localParts, central, end]);
}
