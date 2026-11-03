import fs from 'node:fs';

const txt = fs.readFileSync('server/_items_out.txt', 'utf8');
const lines = txt.split(/\r?\n/);
const out = [];
for (let i = 0; i < lines.length; i++) {
  if (lines[i].trim().startsWith('str=')) {
    const s = JSON.parse(lines[i].trim().slice(4));
    const cps = (lines[i + 1] || '').trim().replace(/^cps=/, '');
    out.push('RAW  : ' + JSON.stringify(s));
    out.push('NFKC : ' + JSON.stringify(s.normalize('NFKC')));
    out.push('cps  : ' + cps);
    out.push('chars: ' + [...s].map((c) => {
      const n = c.normalize('NFKC');
      return `${c}(${c.codePointAt(0).toString(16).toUpperCase()}->${n})`;
    }).join(' | '));
    out.push('');
  }
}
fs.writeFileSync('server/_decode_out.txt', out.join('\n'), 'utf8');
console.log('written');
