/**
 * فحص جودة الاستخراج على كشوف PDF حقيقية (أداة تشخيص للمستخدم، بلا واجهة).
 * الاستخدام:
 *   node server/validateRosters.mjs "C:\...\كشف (85).pdf" "C:\...\كشف (86).pdf"
 *
 * لا يستورد أي بيانات — قراءة فقط، ويكتب التقرير في data/roster_validation.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { extractPdf } from './pdfExtractor.mjs';
import { DATA_DIR } from './store.mjs';

const files = process.argv.slice(2);
if (!files.length) {
  console.error('الاستخدام: node server/validateRosters.mjs <file.pdf> [file2.pdf ...]');
  process.exit(1);
}

const out = {};
for (const f of files) {
  const t0 = Date.now();
  const res = await extractPdf(fs.readFileSync(f), path.basename(f));
  out[path.basename(f)] = { ...res, tookMs: Date.now() - t0 };
}

fs.writeFileSync(path.join(DATA_DIR, 'roster_validation.json'), JSON.stringify(out, null, 2), 'utf8');

for (const [name, r] of Object.entries(out)) {
  const review = r.rows.filter((x) => x.needsReview);
  console.log(`\n=== ${name} ===`);
  console.log('header:', JSON.stringify(r.header));
  console.log(`rows=${r.rows.length} review=${review.length} unmapped=${r.unmapped.length} dups=${r.duplicatesInFile.length} took=${r.tookMs}ms`);
  if (r.unmapped.length) console.log('unmapped:', JSON.stringify(r.unmapped));
  console.log('sample codes:', r.rows.slice(0, 5).map((x) => x.studentCode).join(', '));
  for (const x of r.rows.slice(0, 5)) {
    console.log('   ', x.studentCode, '|', x.fullName, x.needsReview ? `| REVIEW: ${x.reviewNotes.join('; ')}` : '');
  }
  if (review.length) {
    console.log('--- صفوف تحتاج مراجعة ---');
    for (const x of review) {
      console.log('   ', x.index, '|', x.studentCode || '(لا كود)', '|', x.fullName || '(لا اسم)', '|', x.reviewNotes.join('; '));
    }
  }
}
console.log(`\nكُتب التقرير: ${path.join(DATA_DIR, 'roster_validation.json')}`);
