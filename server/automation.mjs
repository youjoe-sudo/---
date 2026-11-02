/**
 * أتمتة إدخال ملف Excel إلى موقع مديرية شرقية عبر Playwright.
 *
 * مبادئ صارمة:
 *  - لا يُعلَن "نجاح" أبداً دون مؤشر تحقّق فعلي مطابق.
 *  - لا يتجاوز أي اختبار روبوت (CAPTCHA) — يوقف ويسلّم للمستخدم.
 *  - لا تخمين محددات (selectors) خاصة بالموقع، ولا إعادة إرسال عمياء.
 *  - لا تُخزَّن أي بيانات اعتماد في ملفات JSON أو السجلات.
 *  - كل خطوة موثّقة بلقطة شاشة في data/evidence/.
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { EVIDENCE_DIR, log } from './store.mjs';

const CHANNELS = ['msedge', 'chrome', 'msedge-beta', 'chrome-beta', 'chromium'];

const CAPTCHA_SELECTORS = [
  'iframe[src*="recaptcha"]',
  'iframe[src*="hcaptcha"]',
  'iframe[src*="turnstile"]',
  'iframe[src*="captcha"]',
  '.g-recaptcha',
  '.h-captcha',
  '[data-sitekey]',
];
const CAPTCHA_TEXT = /اختبر أنك لست روبوت|أنا لست روبوت|reCAPTCHA|hcaptcha|Cloudflare|اختبار روبوت|لست آلي|verify you are (?:human|not a robot)/i;

const SUBMIT_KEYWORDS = ['رفع', 'استيراد', 'ارسال', 'إرسال', 'حفظ', 'تأكيد', 'إدخال', 'ادخال', 'تنفيذ', 'submit', 'upload', 'import', 'save'];

const DEFAULT_SUCCESS_INDICATORS = [
  'تم الرفع بنجاح',
  'تم التحميل بنجاح',
  'تم الحفظ بنجاح',
  'تم تسجيل الغياب',
  'تم الإدخال بنجاح',
  'تم الاستيراد بنجاح',
  'تم تنفيذ العملية بنجاح',
];

let activeBrowser = null; // يُستخدم لوضع "التسليم اليدوي" مع فتح المتصفح

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function makeStep(step, ok, detail) {
  return { step, ok: !!ok, detail: String(detail ?? '').slice(0, 600), at: new Date().toISOString() };
}

async function shot(page, evidence, label) {
  try {
    const file = path.join(EVIDENCE_DIR, `${stamp()}_${label}.png`);
    await fs.promises.mkdir(EVIDENCE_DIR, { recursive: true });
    await page.screenshot({ path: file, fullPage: true });
    evidence.push({ type: 'screenshot', path: file, at: new Date().toISOString() });
    return file;
  } catch (e) {
    evidence.push({ type: 'log', path: '', detail: `تعذّر أخذ لقطة (${label}): ${e.message}`, at: new Date().toISOString() });
    return null;
  }
}

function normalizeArabicText(s) {
  return String(s || '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[\u064B-\u0652]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function detectCaptcha(page) {
  for (const sel of CAPTCHA_SELECTORS) {
    const el = await page.$(sel);
    if (el) {
      const box = await el.boundingBox().catch(() => null);
      if (box) return { found: true, reason: `عنصر اختبار روبوت ظاهر (${sel})` };
      // العنصر موجود لكن مخفي — ليس حائجاً فعلياً
    }
  }
  try {
    const txt = normalizeArabicText(await page.evaluate(() => document.body ? document.body.innerText : ''));
    if (CAPTCHA_TEXT.test(txt)) return { found: true, reason: 'نص اختبار روبوت ظاهر في الصفحة' };
  } catch { /* تجاهل */ }
  return { found: false, reason: '' };
}

/**
 * تشغيل عملية الإدخال.
 * @returns {Promise<object>} نتيجة موثّقة (steps + evidence + status)
 */
export async function runAutomation({ date, classId, excelPath, settings }) {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const steps = [];
  const evidence = [];
  const finish = (status, message, extra = {}) => ({
    // ok تعني "تمت العملية بنجاح فعلاً" — أي حالة أخرى ليست نجاحاً
    ok: status === 'success',
    status,
    message,
    steps,
    evidence,
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - t0,
    excelPath: excelPath || null,
    date,
    classId,
    ...extra,
  });

  /* 1) رابط الموقع */
  const siteUrl = String(settings.siteUrl || '').trim();
  if (!siteUrl) {
    steps.push(makeStep('التحقق من إعدادات الموقع', false, 'لم يتم ضبط رابط الموقع بعد'));
    return finish('missing_url',
      'لم يتم ضبط رابط الموقع بعد. افتح شاشة «الأتمتة» أو «الإعدادات» وأدخل رابط مديرية شرقية، ثم أعد المحاولة.');
  }
  let url;
  try {
    url = new URL(siteUrl);
    if (!/^https?:$/.test(url.protocol)) throw new Error('بروتوكول غير مدعوم');
    steps.push(makeStep('التحقق من رابط الموقع', true, siteUrl));
  } catch (e) {
    steps.push(makeStep('التحقق من رابط الموقع', false, `رابط غير صالح: ${e.message}`));
    return finish('error', 'رابط الموقع غير صالح. عدّله من شاشة الإعدادات.');
  }

  /* 2) ملف Excel */
  if (excelPath && !fs.existsSync(excelPath)) {
    steps.push(makeStep('التحقق من ملف Excel', false, `الملف غير موجود: ${excelPath}`));
    return finish('error', 'ملف Excel غير موجود. أنشئ الملف أولاً من شاشة «تصدير Excel».');
  }
  steps.push(makeStep('التحقق من ملف Excel', true, excelPath ? path.basename(excelPath) : 'لم يُطلب تصدير جديد'));

  /* 3) تشغيل المتصفح */
  // المتصفح يُفتح ظاهراً افتقاراً لدعم "التسليم اليدوي" — يمكن جعله مخفياً من الإعدادات
  const headless = !!settings.headless;
  let browser = null;
  let page = null;
  let launchedVia = '';
  for (const channel of [settings.browser, ...CHANNELS]) {
    if (!channel) continue;
    try {
      browser = await chromium.launch({ channel, headless, args: ['--disable-blink-features=AutomationControlled'] });
      launchedVia = channel;
      break;
    } catch { /* جرّب التالي */ }
  }
  if (!browser) {
    steps.push(makeStep('تشغيل المتصفح', false, 'لم يُعثر على متصفح متوافق (Edge أو Chrome)'));
    return finish('error',
      'تعذّر تشغيل المتصفح. تأكد من تثبيت Microsoft Edge أو Google Chrome على الجهاز، ثم أعد المحاولة.');
  }
  activeBrowser = browser;
  steps.push(makeStep('تشغيل المتصفح', true, `عبر ${launchedVia}${headless ? ' (مخفية)' : ''}`));

  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      locale: 'ar-EG',
      ignoreHTTPSErrors: true,
    });
    page = await context.newPage();
    // لا نمرر أي بيانات اعتماد مخزّنة — ولا نخزّن أي شيء هنا
    page.setDefaultTimeout(Number(settings.timeoutMs) || 45000);

    /* 4) فتح الموقع */
    let resp = null;
    try {
      resp = await page.goto(siteUrl, { waitUntil: 'domcontentloaded', timeout: Number(settings.timeoutMs) || 45000 });
    } catch (e) {
      steps.push(makeStep('فتح الموقع', false, e.message));
      await shot(page, evidence, 'open-failed');
      return finish('error', `تعذّر فتح الموقع: ${e.message}. تأكد من الاتصال بالإنترنت ومن صحة الرابط.`);
    }
    const status = resp ? resp.status() : 0;
    steps.push(makeStep('فتح الموقع', status >= 200 && status < 400, `HTTP ${status}`));
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    await shot(page, evidence, '01-opened');
    if (status >= 500) {
      return finish('error', `الموقع يعيد خطأ ${status}. حاول لاحقاً.`);
    }

    /* 5) كشف اختبار الروبوت — لا نتجاوزه أبداً */
    let captcha = await detectCaptcha(page);
    if (captcha.found) {
      steps.push(makeStep('التحقق من اختبار الروبوت', false, captcha.reason));
      await shot(page, evidence, '02-captcha');
      if (settings.manualFallback !== false) {
        steps.push(makeStep('التسليم للمستخدم لإكمال العملية يدوياً', true, 'المتصفح مفتوح أمامك'));
        return finish('blocked_captcha',
          'تم رصد اختبار روبوت (CAPTCHA). لا يمكن تجاوزه آلياً — أكمل العملية يدوياً، المتصفح مفتوح أمامك.',
          { manualHandoff: true });
      }
      return finish('blocked_captcha', 'تم رصد اختبار روبوت (CAPTCHA). لا يمكن تجاوزه آلياً.');
    }
    steps.push(makeStep('التحقق من اختبار الروبوت', true, 'لا يوجد حائل'));

    /* 6) إرفاق ملف Excel */
    if (excelPath) {
      const inputs = await page.$$('input[type="file"]');
      if (!inputs.length) {
        steps.push(makeStep('إرفاق ملف Excel', false, 'لم يُعثر على حقل رفع ملفات في الصفحة'));
        await shot(page, evidence, '02-no-file-input');
        if (settings.manualFallback !== false) {
          steps.push(makeStep('التسليم للمستخدم لإكمال العملية يدوياً', true, 'المتصفح مفتوح أمامك'));
          return finish('needs_manual',
            'لم يُعثر على حقل رفع ملفات في الصفحة المفتوحة (قد تكون الصفحة تحتاج تسجيل دخول أولاً). المتصفح مفتوح أمامك لإكمال العملية يدوياً.',
            { manualHandoff: true });
        }
        return finish('needs_manual', 'لم يُعثر على حقل رفع ملفات في الصفحة المفتوحة.');
      }
      let attached = 0;
      for (const input of inputs) {
        try {
          await input.setInputFiles(excelPath);
          attached += 1;
        } catch { /* حقل غير قابل للتعبئة */ }
      }
      if (!attached) {
        steps.push(makeStep('إرفاق ملف Excel', false, 'تعذّر تعبئة حقول الرفع المتاحة'));
        await shot(page, evidence, '02-file-attach-failed');
        return finish('needs_manual', 'تعذّر إرفاق الملف تلقائياً. المتصفح مفتوح أمامك لإكمال العملية يدوياً.',
          { manualHandoff: settings.manualFallback !== false });
      }
      steps.push(makeStep('إرفاق ملف Excel', true, `${path.basename(excelPath)} إلى ${attached} حقل`));
      await shot(page, evidence, '03-file-attached');

      /* 7) الضغط على زر الإرسال — فقط لو كان معلناً وبكلمة مفهومة */
      const candidates = await page.$$eval('button, input[type="submit"], a[role="button"]', (els, keywords) => {
        const out = [];
        els.forEach((el, i) => {
          const text = ((el.innerText || el.value || '') + '').trim();
          if (!text) return;
          const low = text.toLowerCase();
          const hit = keywords.some((k) => low.includes(k.toLowerCase()));
          const rect = el.getBoundingClientRect();
          if (!hit || rect.width < 4 || rect.height < 4) return;
          if (el.disabled) return;
          out.push({ i, text });
        });
        return out;
      }, SUBMIT_KEYWORDS).catch(() => []);

      if (candidates.length === 1) {
        const target = candidates[0];
        steps.push(makeStep('الضغط على زر الإرسال', true, `زر معلَّن: "${target.text}"`));
        try {
          const els = await page.$$('button, input[type="submit"], a[role="button"]');
          await els[target.i].click();
          await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
          await page.waitForTimeout(1500);
        } catch (e) {
          steps[steps.length - 1].ok = false;
          steps[steps.length - 1].detail += ` — فشل النقر: ${e.message}`;
        }
        await shot(page, evidence, '04-after-submit');
      } else if (candidates.length === 0) {
        steps.push(makeStep('الضغط على زر الإرسال', false, 'لم يُعثر على زر إرسال معلَّن وبكلمة مفهومة — لن نخمن'));
        await shot(page, evidence, '04-no-submit');
      } else {
        steps.push(makeStep('الضغط على زر الإرسال', false,
          `${candidates.length} أزرار مطابقة — لن نخمن أيها الصحيح`));
        await shot(page, evidence, '04-ambiguous-submit');
      }

      /* 8) كشف اختبار الروبوت بعد الإرسال */
      captcha = await detectCaptcha(page);
      if (captcha.found) {
        steps.push(makeStep('التحقق النهائي من اختبار الروبوت', false, captcha.reason));
        await shot(page, evidence, '05-captcha-after');
        if (settings.manualFallback !== false) {
          steps.push(makeStep('التسليم للمستخدم لإكمال العملية يدوياً', true, 'المتصفح مفتوح أمامك'));
          return finish('blocked_captcha',
            'تم رصد اختبار روبوت بعد محاولة الإرسال. لا يمكن تجاوزه آلياً — أكمل يدوياً، المتصفح مفتوح.',
            { manualHandoff: true });
        }
        return finish('blocked_captcha', 'تم رصد اختبار روبوت بعد محاولة الإرسال.');
      }
    }

    /* 9) التحقق من النجاح بمؤشرات فعلية فقط */
    const pageText = normalizeArabicText(await page.evaluate(() => document.body ? document.body.innerText : ''));
    const configured = (settings.successIndicators || []).map((s) => String(s).trim()).filter(Boolean);
    const indicators = configured.length ? configured : DEFAULT_SUCCESS_INDICATORS;
    const matched = indicators.find((needle) => pageText.includes(normalizeArabicText(needle)));

    await shot(page, evidence, '05-final');

    if (matched) {
      steps.push(makeStep('التحقق من نتيجة العملية', true, `مؤشر نجاح مطابق: "${matched}"`));
      if (settings.manualFallback !== false) {
        await browser.close().catch(() => {});
        activeBrowser = null;
      }
      return finish('success', `تم الإدخال بنجاح بحسب المؤشر المطابق: "${matched}".`, { manualHandoff: false });
    }

    steps.push(makeStep('التحقق من نتيجة العملية', false,
      'لم يظهر أي مؤشر نجاح مطابق — لا يمكن إعلان النجاح دون تحقق فعلي'));

    if (settings.manualFallback !== false) {
      steps.push(makeStep('التسليم للمستخدم لإكمال العملية يدوياً', true, 'المتصفح مفتوح أمامك للمراجعة'));
      return finish('needs_manual',
        'تمت محاولة الإدخال لكن لم يظهر مؤشر نجاح مؤكد. راجع الصفحة (المتصفح مفتوح أمامك) وأكد يدوياً. لقطات الشاشة محفوظة كأدلة.',
        { manualHandoff: true });
    }
    return finish('needs_manual',
      'تمت محاولة الإدخال لكن لم يظهر مؤشر نجاح مؤكد. راجع لقطات الشاشة في مجلد الأدلة.');
  } catch (e) {
    steps.push(makeStep('تنفيذ العملية', false, e.message));
    await log('error', `الأتمتة: ${e.message}`);
    return finish('error', `حدث خطأ أثناء الأتمتة: ${e.message}`);
  } finally {
    // المتصفح يبقى مفتوحاً فقط عند تسليم يدوي، وإلا يُغلق
    if (activeBrowser && !steps.some((s) => s.step.startsWith('التسليم للمستخدم'))) {
      await activeBrowser.close().catch(() => {});
      activeBrowser = null;
    }
  }
}

export async function closeManualBrowser() {
  if (activeBrowser) {
    await activeBrowser.close().catch(() => {});
    activeBrowser = null;
    return { ok: true, closed: true };
  }
  return { ok: true, closed: false };
}
