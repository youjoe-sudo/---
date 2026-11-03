import fs from 'node:fs';
const txt = fs.readFileSync('server/_decode_out.txt', 'utf8');
for (const line of txt.split(/\r?\n/)) {
  if (!line.startsWith('RAW')) continue;
  const s = JSON.parse(line.slice(line.indexOf(':') + 1).trim());
  if (!/[\u0600-\u06FF\uFB50-\uFEFF]/.test(s)) continue;
  console.log(`len=${[...s].length}  words=${s.split(' ').map((w) => [...w].length).join('+')}  ${JSON.stringify(s)}`);
}
