import { crc32, deflateSync } from 'node:zlib';

/** A PNG for tests: `colorType` 2 (RGB) or 6 (RGBA), filled with one colour. */
export function testPng(
  width: number,
  height: number,
  {
    colorType = 6,
    interlace = 0,
    trns = false,
  }: { colorType?: 2 | 6; interlace?: 0 | 1; trns?: boolean } = {},
): Uint8Array {
  const channels = colorType === 6 ? 4 : 3;
  const raw = Buffer.alloc((width * channels + 1) * height, 0x80);
  for (let y = 0; y < height; y++) raw[y * (width * channels + 1)] = 0;
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), body.length + 4);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = colorType;
  header[12] = interlace;
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', header),
      ...(trns ? [chunk('tRNS', Buffer.from([0, 0, 0, 0, 0, 0]))] : []),
      chunk('IDAT', deflateSync(raw)),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  );
}
