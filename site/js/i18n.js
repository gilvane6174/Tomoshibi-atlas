// 画面の文言を言語ファイルから引く。対応言語は日本語と英語。
// 言語は URL の ?lang=en で切り替える（Cookie やブラウザ保存は使わない）。
// 文言中の <b>…</b> だけは太字として扱い、それ以外のタグは一切解釈しない（すべて文字として表示）。

export const LANGS = ['ja', 'en'];
let dict = {};
export let lang = 'ja';

export function detectLanguage() {
  const q = new URLSearchParams(location.search).get('lang');
  return LANGS.includes(q) ? q : 'ja';
}

export async function loadLanguage(code) {
  lang = LANGS.includes(code) ? code : 'ja';
  const res = await fetch(`i18n/${lang}.json`, { cache: 'no-cache' });
  if (!res.ok) throw new Error('i18n load failed');
  dict = await res.json();
  document.documentElement.lang = lang;
}

export function t(key, vars = {}) {
  const raw = dict[key] ?? key;
  return raw.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(vars[k]) : ''));
}

// data-i18n / data-i18n-placeholder 属性を持つ要素に文言を入れる
export function applyStatic(root = document) {
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll('[data-i18n-placeholder]')) el.placeholder = t(el.dataset.i18nPlaceholder);
}

// <b> だけを安全に組み立てて要素に入れる（innerHTML は使わない）
export function setRich(el, key, vars) {
  el.replaceChildren();
  for (const part of t(key, vars).split(/(<b>.*?<\/b>)/g)) {
    const m = part.match(/^<b>(.*)<\/b>$/);
    if (m) {
      const s = document.createElement('strong');
      s.textContent = m[1];
      el.append(s);
    } else if (part) el.append(document.createTextNode(part));
  }
}

// 多言語フィールド（{ja, en, original}）から表示する文字列を選ぶ。
// 表示言語の文言が無い場合は、ほかの言語で表示し、その言語名を返す（「日本語のみ」等の表示に使う）
export function pickText(obj) {
  if (!obj) return { text: '', shownIn: lang };
  if (obj[lang]) return { text: obj[lang], shownIn: lang };
  if (lang === 'en' && obj.ja) return { text: obj.ja, shownIn: 'ja' };
  if (lang === 'ja' && obj.en) return { text: obj.en, shownIn: 'en' };
  return { text: obj.original || '', shownIn: lang };
}
export const pick = (obj) => pickText(obj).text;

// URL に言語を保ったまま、別言語版のURLを作る
export function urlForLang(code) {
  const u = new URL(location.href);
  if (code === 'ja') u.searchParams.delete('lang');
  else u.searchParams.set('lang', code);
  u.hash = '';
  // 「//」で始まるパスが他サイトへのリンクとして解釈されないよう、必ず同じサイト内の相対パスにする
  return './' + u.pathname.split('/').pop() + u.search;
}
