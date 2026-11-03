import fs from 'node:fs';
import path from 'node:path';
import { createCanvas } from '@napi-rs/canvas';

const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
const STANDARD_FONT_DIR = path.join(process.cwd(), 'node_modules', 'pdfjs-dist', 'standard_fonts');

const file = process.argv[2];
const scale = 4;
const bytes = fs.readFileSync(file);
const doc = await pdfjs.getDocument({
  data: new Uint8Array(bytes),
  useSystemFonts: false,
  isEvalSupported: false,
  standardFontDataUrl: `${STANDARD_FONT_DIR}${path.sep}`,
}).promise;

const page = await doc.getPage(1);
const vp = page.getViewport({ scale });
const canvas = createCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
const ctx = canvas.getContext('2d');
ctx.fillStyle = '#ffffff';
ctx.fillRect(0, 0, canvas.width, canvas.height);
await page.render({ canvasContext: ctx, viewport: vp }).promise;

// اقتصاص الشريط حول y=575 (إحداثيات PDF من الأسفل)
const H = page.getViewport({ scale: 1 }).height;
const yTop = Math.round((H - 585) * scale);
const yBot = Math.round((H - 565) * scale);
const crop = createCanvas(canvas.width, yBot - yTop);
crop.getContext('2d').drawImage(canvas, 0, yTop, canvas.width, yBot - yTop, 0, 0, canvas.width, yBot - yTop);

fs.writeFileSync('server/_row.png', crop.toBuffer('image/png'));
console.log('written server/_row.png', canvas.width, yBot - yTop, 'pageH', H);
