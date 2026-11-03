import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const file = process.argv[2];
const needle = process.argv[3] || 'اصم';

const r = spawnSync(process.execPath, ['server/_probe.mjs', file], {
  env: { ...process.env, PDF_TRACE: 'ALL' },
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
});
const err = r.stderr || '';
const lines = err.split(/\r?\n/);

const out = [];
const idx = lines.findIndex((l) => l.includes('text=') && l.includes(needle));
if (idx < 0) {
  console.log('not found. sample lines:');
  console.log(lines.slice(0, 5).join('\n'));
  process.exit(0);
}
out.push('CELL: ' + lines[idx]);

let items = null;
for (let i = idx; i < lines.length; i++) {
  if (lines[i].startsWith('[trace] items:')) {
    items = JSON.parse(lines[i].slice('[trace] items:'.length));
    break;
  }
}
if (!items) { console.log(out.join('\n')); process.exit(0); }

const byY = new Map();
for (const it of items) {
  const k = Math.round(it.y);
  if (!byY.has(k)) byY.set(k, []);
  byY.get(k).push(it);
}
for (const [y, arr] of [...byY.entries()].sort((a, b) => b[0] - a[0])) {
  out.push(`\n=== y=${y} ===`);
  arr.sort((a, b) => b.x - a.x);
  for (const it of arr) {
    const cps = [...it.str].map((c) => 'U+' + c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')).join(' ');
    out.push(`  x=${it.x} w=${it.w} base=${it.base}`);
    out.push(`    str=${JSON.stringify(it.str)}`);
    out.push(`    cps=${cps}`);
  }
}
fs.writeFileSync('server/_items_out.txt', out.join('\n'), 'utf8');
console.log('written server/_items_out.txt');
