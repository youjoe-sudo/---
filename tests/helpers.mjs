/** أدوات مساعدة للاختبارات — بيانات اصطناعية فقط، ولا تلمس بيانات المستخدم الحقيقية. */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** يشغّل الخادم على منفذ مؤقت ومجلد بيانات مؤقت، ويعيد عنوانه. */
export async function startServer() {
  const dataDir = tempDir('absence-data-');
  const exportDir = tempDir('absence-exports-');
  const port = 20000 + Math.floor(Math.random() * 20000);

  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.mjs')], {
    env: {
      ...process.env,
      PORT: String(port),
      APP_DATA_DIR: dataDir,
      APP_EXPORT_DIR: exportDir,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const base = `http://127.0.0.1:${port}`;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('انتهت مهلة تشغيل الخادم')), 20000);
    const onData = (buf) => {
      if (String(buf).includes(base)) {
        clearTimeout(timer);
        resolve();
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`خرج الخادم مبكراً: ${code}`)); });
  });

  return {
    base,
    dataDir,
    exportDir,
    async close() {
      child.kill();
      await new Promise((r) => setTimeout(r, 300));
      fs.rmSync(dataDir, { recursive: true, force: true });
      fs.rmSync(exportDir, { recursive: true, force: true });
    },
  };
}

export async function api(base, method, url, body) {
  const res = await fetch(base + url, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { json = null; }
  return { status: res.status, json };
}

/** يبني ملف PDF اصطناعياً (أكواد + أسماء لاتينية) لاختبار خط الاستخراج. */
export async function makeSyntheticPdf(students) {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const bold = await doc.embedFont(StandardFonts.CourierBold);
  const reg = await doc.embedFont(StandardFonts.Helvetica);

  // ترويسة بسيطة (تسميات عربية لا يمكن كتابتها بخط قياسي — نستخدم نصاً لاتينياً للتجربة)
  page.drawText('CLASS LIST', { x: 200, y: 800, size: 12, font: bold, color: rgb(0, 0, 0) });

  let y = 760;
  for (const s of students) {
    if (s.code) page.drawText(s.code, { x: 450, y, size: 10, font: bold });
    if (s.name) page.drawText(s.name, { x: 120, y, size: 10, font: reg });
    y -= 18;
  }
  return Buffer.from(await doc.save());
}
