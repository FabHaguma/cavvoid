// Rasterize the existing SVG's ellipse/circle geometry for launcher icons.
// No image package or remote image generation is needed for this vector logo.
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
const directory = new URL("../frontend/assets/pwa/", import.meta.url);
mkdirSync(directory, { recursive: true });
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const name = Buffer.from(type),
    length = Buffer.alloc(4),
    crc = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, crc]);
}
for (const [name, size, scale] of [
  ["icon-192", 192, 1],
  ["icon-512", 512, 1],
  ["icon-maskable-512", 512, 0.8],
  ["apple-touch-icon", 180, 1],
]) {
  const bytes = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const color = [0, 0, 0];
      // Four samples preserve the small logo's antialiased edges.
      for (const [sx, sy] of [
        [0.25, 0.25],
        [0.75, 0.25],
        [0.25, 0.75],
        [0.75, 0.75],
      ]) {
        const px = (((x + sx) / size) * 64 - 32) / scale,
          py = (((y + sy) / size) * 64 - 32) / scale;
        const a = (-35 * Math.PI) / 180,
          ex = px * Math.cos(a) + py * Math.sin(a),
          ey = -px * Math.sin(a) + py * Math.cos(a);
        let rgb = [23, 19, 31];
        if (Math.abs(Math.sqrt((ex / 22) ** 2 + (ey / 14) ** 2) - 1) < 2 / 18)
          rgb = [167, 139, 250];
        const radius = Math.hypot(px, py);
        if (radius < 12.5) rgb = radius > 9.5 ? [209, 193, 255] : [12, 12, 18];
        for (let c = 0; c < 3; c++) color[c] += rgb[c] / 4;
      }
      const offset = y * (size * 4 + 1) + 1 + x * 4;
      for (let c = 0; c < 3; c++) bytes[offset + c] = Math.round(color[c]);
      bytes[offset + 3] = 255;
    }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  writeFileSync(
    new URL(name + ".png", directory),
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk("IHDR", header),
      chunk("IDAT", deflateSync(bytes)),
      chunk("IEND", Buffer.alloc(0)),
    ]),
  );
}
console.log(
  "Generated 192px, 512px, maskable and Apple icons from CavVoid's logo geometry.",
);
