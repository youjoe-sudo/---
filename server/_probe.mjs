import fs from 'node:fs';
import { extractPdf } from './pdfExtractor.mjs';

const file = process.argv[2];
const bytes = fs.readFileSync(file);
const out = await extractPdf(bytes, file.split(/[\\/]/).pop());

const rows = out.rows || [];
const lines = [];
lines.push(`rows: ${rows.length}  pages: ${out.pages}  unmapped: ${(out.unmapped || []).length}`);
lines.push(`header: ${JSON.stringify(out.header)}`);
rows.forEach((r, i) => {
  lines.push(
    [
      String(i + 1).padStart(3, '0'),
      String(r.page),
      r.studentCode || '----------',
      r.fullName || '',
      '| phys=' + r.physKey,
      '| x=' + (r.cells && r.cells[0] ? Math.round(r.cells[0].x0) : '?'),
      '| review=' + (r.needsReview ? '1' : '0'),
      '| ' + (r.reviewNotes || []).join('; '),
    ].join('  '),
  );
});
if (out.warnings && out.warnings.length) {
  lines.push('--- warnings ---');
  for (const w of out.warnings) lines.push('  ' + w);
}
fs.writeFileSync('server/_names.txt', lines.join('\n'), 'utf8');
console.log('written server/_names.txt', rows.length);
