/**
 * 生成 tabBar 占位图标 PNG 文件
 *
 * 避免在命令行拼接超长 base64，改用 Node.js zlib 直接生成有效 PNG 二进制。
 * 生成 81x81（微信推荐尺寸）纯色 PNG：
 *  - inactive: #7A7E83（灰）
 *  - active:   #4CAF50（绿，匹配 pages.json 的 selectedColor）
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 81;

/** 生成指定纯色的 81x81 PNG Buffer */
function makePng(r, g, b) {
  // 构造原始像素数据：每行以 filter byte 0 开头
  const rowBytes = SIZE * 4;
  const raw = Buffer.alloc((rowBytes + 1) * SIZE);
  for (let y = 0; y < SIZE; y++) {
    raw[y * (rowBytes + 1)] = 0; // filter: None
    for (let x = 0; x < SIZE; x++) {
      const off = y * (rowBytes + 1) + 1 + x * 4;
      raw[off] = r;
      raw[off + 1] = g;
      raw[off + 2] = b;
      raw[off + 3] = 255; // 不透明
    }
  }

  const compressed = zlib.deflateSync(raw);

  // PNG chunks
  function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, 'ascii');
    const crc = Buffer.alloc(4);
    // CRC over type + data
    const crcVal = crc32(Buffer.concat([typeBuf, data]));
    crc.writeUInt32BE(crcVal >>> 0, 0);
    return Buffer.concat([len, typeBuf, data, crc]);
  }

  function crc32(buf) {
    let c = ~0;
    for (let i = 0; i < buf.length; i++) {
      c ^= buf[i];
      for (let k = 0; k < 8; k++) {
        c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
      }
    }
    return ~c;
  }

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0);  // width
  ihdr.writeUInt32BE(SIZE, 4);  // height
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const iend = Buffer.alloc(0);

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', iend),
  ]);
}

const outDir = path.resolve(__dirname, '..', 'src', 'static');
fs.mkdirSync(outDir, { recursive: true });

const icons = [
  { name: 'home.png',           r: 0x7A, g: 0x7E, b: 0x83 },
  { name: 'home-active.png',    r: 0x4C, g: 0xAF, b: 0x50 },
  { name: 'task.png',           r: 0x7A, g: 0x7E, b: 0x83 },
  { name: 'task-active.png',    r: 0x4C, g: 0xAF, b: 0x50 },
  { name: 'chat.png',           r: 0x7A, g: 0x7E, b: 0x83 },
  { name: 'chat-active.png',    r: 0x4C, g: 0xAF, b: 0x50 },
  { name: 'profile.png',        r: 0x7A, g: 0x7E, b: 0x83 },
  { name: 'profile-active.png', r: 0x4C, g: 0xAF, b: 0x50 },
];

for (const ic of icons) {
  const buf = makePng(ic.r, ic.g, ic.b);
  const fp = path.join(outDir, ic.name);
  fs.writeFileSync(fp, buf);
  console.log(`✓ ${ic.name} (${buf.length} bytes) -> ${fp}`);
}

console.log(`\n共生成 ${icons.length} 个图标到: ${outDir}`);
