/**
 * 轻量级 TabBar 图标生成器
 * 纯 Node.js 实现，无第三方依赖
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 81;
const OUTPUT_DIR = path.join(__dirname, '../src/static');

const COLOR_NORMAL = [138, 143, 152];
const COLOR_ACTIVE = [76, 175, 80];

// ===== PNG 编码 =====
function crc32(buf) {
  let crc = 0xFFFFFFFF;
  const tbl = [];
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    tbl[i] = c;
  }
  for (let i = 0; i < buf.length; i++) crc = tbl[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  const td = Buffer.concat([Buffer.from(type), data]);
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, c]);
}

function makePNG(w, h, pixels) {
  const sig = Buffer.from([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8]=8; ihdr[9]=6;
  const raw = Buffer.alloc(h * (w*4+1));
  for (let y=0;y<h;y++){ raw[y*(w*4+1)]=0; pixels.copy(raw, y*(w*4+1)+1, y*w*4, (y+1)*w*4); }
  const comp = zlib.deflateSync(raw);
  return Buffer.concat([sig, chunk('IHDR',ihdr), chunk('IDAT',comp), chunk('IEND',Buffer.alloc(0))]);
}

// ===== 绘图类 =====
class Painter {
  constructor(size) {
    this.s = size;
    this.buf = new Uint8ClampedArray(size * size * 4);
    this.clr = null;
    this.lw = 3.5;
  }

  clear() { this.buf.fill(0); }

  setColor(r,g,b,a=255) { this.clr = [r,g,b,a]; }
  setLW(w) { this.lw = w; }

  // 圆形笔刷绘制
  dot(x, y) {
    if (!this.clr) return;
    const r = this.lw / 2;
    const ri = Math.ceil(r);
    for (let dy = -ri; dy <= ri; dy++) {
      for (let dx = -ri; dx <= ri; dx++) {
        if (dx*dx + dy*dy <= r*r) {
          this._px(Math.round(x)+dx, Math.round(y)+dy);
        }
      }
    }
  }

  _px(x, y) {
    if (x<0||x>=this.s||y<0||y>=this.s) return;
    const i = (y*this.s+x)*4;
    this.buf[i]=this.clr[0]; this.buf[i+1]=this.clr[1]; this.buf[i+2]=this.clr[2]; this.buf[i+3]=this.clr[3];
  }

  // Bresenham 画线
  line(x0,y0,x1,y1) {
    x0=Math.round(x0);y0=Math.round(y0);x1=Math.round(x1);y1=Math.round(y1);
    const dx=Math.abs(x1-x0), dy=Math.abs(y1-y0);
    const sx=x0<x1?1:-1, sy=y0<y1?1:-1;
    let err=dx-dy, x=x0, y=y0;
    while(true) {
      this.dot(x,y);
      if(x===x1&&y===y1) break;
      const e2=2*err;
      if(e2>-dy){err-=dy;x+=sx;}
      if(e2<dx){err+=dx;y+=sy;}
    }
  }

  // 路径
  path(pts) { for(let i=0;i<pts.length-1;i++) this.line(pts[i][0],pts[i][1],pts[i+1][0],pts[i+1][1]); }

  // 圆弧
  arc(cx,cy,r,a0,a1) {
    const steps = Math.max(20, Math.round(r*2));
    const pts=[];
    for(let i=0;i<=steps;i++){
      const a=a0+(a1-a0)*(i/steps);
      pts.push([cx+r*Math.cos(a), cy+r*Math.sin(a)]);
    }
    this.path(pts);
  }

  // 圆
  circle(cx,cy,r) { this.arc(cx,cy,r,0,Math.PI*2); }

  // 圆角矩形
  rrect(x,y,w,h,r) {
    r=Math.min(r,w/2,h/2);
    this.arc(x+w-r,y+r,r,-Math.PI/2,0);       // 右上
    this.arc(x+w-r,y+h-r,r,0,Math.PI/2);       // 右下
    this.arc(x+r,y+h-r,r,Math.PI/2,Math.PI);   // 左下
    this.arc(x+r,y+r,r,Math.PI,Math.PI*1.5);   // 左上
    // 直线
    this.line(x+w,y+r,x+w,y+h-r);   // 右
    this.line(x+r,y+h,x+w-r,y+h);   // 下
    this.line(x,y+h,x+r,y+h);       // 左
    this.line(x+r,y,x+w-r,y);       // 上
  }

  save(filepath) {
    const png = makePNG(this.s, this.s, Buffer.from(this.buf));
    fs.writeFileSync(filepath, png);
    console.log(`  ✓ ${path.basename(filepath)}`);
  }
}

// ===== 图标 =====
function home(p, c) {
  p.setColor(...c); p.setLW(3);
  // 屋顶
  p.path([[12,40],[40,12],[68,40]]);
  // 左墙
  p.line(16,40,16,66);
  // 右墙
  p.line(64,40,64,66);
  // 地板
  p.line(16,66,64,66);
  // 门
  p.line(32,66,32,50);
  p.line(32,50,48,50);
  p.line(48,50,48,66);
}

function task(p, c) {
  p.setColor(...c); p.setLW(3);
  // 剪贴板主体
  p.rrect(16, 20, 48, 44, 4);
  // 夹子
  p.rrect(26, 10, 28, 14, 5);
  // 勾选
  p.line(28, 42, 36, 52);
  p.line(36, 52, 54, 34);
}

function chat(p, c) {
  p.setColor(...c); p.setLW(3);
  // 主气泡
  p.rrect(18, 16, 46, 34, 17);
  // 尾巴
  p.path([[28,50],[20,64],[36,46]]);
  // 小圆点
  p.circle(56, 22, 3);
}

function profile(p, c) {
  p.setColor(...c); p.setLW(3);
  // 头部
  p.circle(40, 26, 12);
  // 肩膀
  p.path([
    [16, 72],
    [20, 60],
    [30, 54],
    [40, 52],
    [50, 54],
    [60, 60],
    [64, 72],
  ]);
}

// ===== 生成 =====
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, {recursive:true});

const icons = [
  {name:'home', fn:home},
  {name:'task', fn:task},
  {name:'chat', fn:chat},
  {name:'profile', fn:profile},
];

console.log('🎨 生成 TabBar 图标...\n');

for (const {name, fn} of icons) {
  // 普通
  const p1 = new Painter(SIZE); p1.clear();
  fn(p1, COLOR_NORMAL);
  p1.save(path.join(OUTPUT_DIR, `${name}.png`));

  // 选中
  const p2 = new Painter(SIZE); p2.clear();
  fn(p2, COLOR_ACTIVE);
  p2.save(path.join(OUTPUT_DIR, `${name}-active.png`));
}

console.log('\n✅ 完成！');
console.log('颜色：未选中 #8A8F98，选中 #4CAF50');