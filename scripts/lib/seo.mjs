// 検索エンジン向けの付帯ファイル（robots.txt / sitemap.xml）と、脆弱性の連絡先（security.txt）を作る。
// 公開URLは GitHub のリポジトリ変数 SITE_URL（例: https://<ユーザー名>.github.io/Tomoshibi-atlas/）から読む。
// 未設定・不正な値のときは、絶対URLが必要なもの（canonical・sitemap）を作らない（推測でURLを書かない）。
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

export function parseSiteUrl(raw) {
  if (!raw) return null;
  let u;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.username || u.password || u.port || u.search || u.hash) return null;
  if (!/^[a-z0-9.-]+$/.test(u.hostname)) return null;
  return u.href.endsWith('/') ? u.href : u.href + '/';
}

const VERIFY = /^[A-Za-z0-9_-]{10,100}$/;
const PAIR_EXTRA = {};
// 日本語だけのページ（日本の制度・窓口の案内）。canonical と og:url を自分自身に付ける
const JA_ONLY = new Set(['life-support.html', 'safety.html', 'welfare-pref.html', 'crime-prevention.html', 'data-leak.html', 'disability-services.html', 'family-support.html', 'emergency-care.html']);
const PAGES = [
  ['index.html', '', 'ja'],
  ['index.html', '?lang=en', 'en'],
  ['about.html', 'about.html', 'ja'],
  ['about.en.html', 'about.en.html', 'en'],
  ['security-basics.html', 'security-basics.html', 'ja'],
  ['security-basics.en.html', 'security-basics.en.html', 'en'],
  ['archive.html', 'archive.html', 'ja'],
  ['archive.en.html', 'archive.en.html', 'en'],
  ['welfare-guide.html', 'welfare-guide.html', 'ja'],
  ['welfare-guide.en.html', 'welfare-guide.en.html', 'en'],
  ['compare.html', 'compare.html', 'ja'],
  ['compare.en.html', 'compare.en.html', 'en'],
  ['weekly.html', 'weekly.html', 'ja'],
  ['weekly.en.html', 'weekly.en.html', 'en'],
  ['updates.html', 'updates.html', 'ja'],
  ['updates.en.html', 'updates.en.html', 'en'],
  ['site-security.html', 'site-security.html', 'ja'],
  ['site-security.en.html', 'site-security.en.html', 'en'],
  ['welfare-pref.html', 'welfare-pref.html', 'ja'],
  ['crime-prevention.html', 'crime-prevention.html', 'ja'],
  ['data-leak.html', 'data-leak.html', 'ja'],
  ['disability-services.html', 'disability-services.html', 'ja'],
  ['family-support.html', 'family-support.html', 'ja'],
  ['emergency-care.html', 'emergency-care.html', 'ja'],
  ['life-support.html', 'life-support.html', 'ja'],
  ['safety.html', 'safety.html', 'ja'],
  ['world-heritage.html', 'world-heritage.html', 'ja'],
  ['world-heritage.en.html', 'world-heritage.en.html', 'en'],
];
// 英語版と日本語版の組（canonical・hreflang 用）。2026-11 に追加したページも同じ形
for (const n of ['weekly', 'updates', 'site-security', 'world3d', 'world-heritage']) {
  PAIR_EXTRA[`${n}.html`] = [`${n}.html`, `${n}.en.html`];
  PAIR_EXTRA[`${n}.en.html`] = [`${n}.html`, `${n}.en.html`];
}
const PAIRS_BASE = { 'index.html': ['', '?lang=en'], 'about.html': ['about.html', 'about.en.html'], 'about.en.html': ['about.html', 'about.en.html'], 'security-basics.html': ['security-basics.html', 'security-basics.en.html'], 'security-basics.en.html': ['security-basics.html', 'security-basics.en.html'], 'welfare-guide.html': ['welfare-guide.html', 'welfare-guide.en.html'], 'welfare-guide.en.html': ['welfare-guide.html', 'welfare-guide.en.html'], 'compare.html': ['compare.html', 'compare.en.html'], 'compare.en.html': ['compare.html', 'compare.en.html'], 'archive.html': ['archive.html', 'archive.en.html'], 'archive.en.html': ['archive.html', 'archive.en.html'] };
const PAIRS = { ...PAIRS_BASE, ...PAIR_EXTRA };
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// extraPaths：組み立て時に作ったページ（都道府県別のページなど。日本語だけ）を sitemap に足す
export function writeSeo(out, { siteUrl, repo, google, bing, now = new Date(), extraPaths = [] }) {
  const base = parseSiteUrl(siteUrl);
  for (const name of readdirSync(out).filter((n) => n.endsWith('.html'))) {
    const file = resolve(out, name);
    let html = readFileSync(file, 'utf8');
    const tags = [];
    // 日本語だけのページ（都道府県別など）は、自分自身への canonical と og:url だけを付ける
    if (base && !PAIRS[name] && (JA_ONLY.has(name) || extraPaths.includes(name))) {
      tags.push(`<link rel="canonical" href="${esc(base + name)}">`, `<meta property="og:url" content="${esc(base + name)}">`);
    }
    if (base && PAIRS[name]) {
      // 相対パスの hreflang は、絶対URL版に置き換える（重複させない）
      html = html.replace(/[ \t]*<link rel="alternate" hreflang="(?:ja|en)" href="(?!https:)[^"]*">\n/g, '');
      const [ja, en] = PAIRS[name];
      const self = name.endsWith('.en.html') ? en : ja;
      // 地球儀のページは ?lang=en で英語版になるため、canonical は付けない（英語版が重複扱いで除外されるのを防ぐ）
      if (name !== 'index.html') tags.push(`<link rel="canonical" href="${esc(base + self)}">`);
      tags.push(`<meta property="og:url" content="${esc(base + self)}">`);
      // SNS で共有したときの画像（地球儀とサイト名。1200×630）
      tags.push(`<meta property="og:image" content="${esc(base)}og-image.png">`, '<meta property="og:image:width" content="1200">', '<meta property="og:image:height" content="630">', '<meta property="og:image:alt" content="Tomoshibi Atlas — a dark globe with small lights">', `<meta name="twitter:image" content="${esc(base)}og-image.png">`);
      tags.push(`<link rel="alternate" hreflang="ja" href="${esc(base + ja)}">`, `<link rel="alternate" hreflang="en" href="${esc(base + en)}">`, `<link rel="alternate" hreflang="x-default" href="${esc(base + ja)}">`);
    }
    if (name === 'index.html') {
      if (google && VERIFY.test(google)) tags.push(`<meta name="google-site-verification" content="${google}">`);
      if (bing && VERIFY.test(bing)) tags.push(`<meta name="msvalidate.01" content="${bing}">`);
    }
    html = html.replace(/<!-- seo:abs[^>]*-->/, tags.join('\n  '));
    writeFileSync(file, html);
  }
  const robots = ['User-agent: *', 'Allow: /'];
  if (base) {
    robots.push(`Sitemap: ${base}sitemap.xml`);
    // lastmod は書かない（組み立てのたびに全ページの日付が変わり、本当の更新日と合わなくなるため。検索エンジンの案内に沿う）
    const urls = [...PAGES.map(([, path]) => path), ...extraPaths].map((path) => `  <url><loc>${esc(base + path)}</loc></url>`);
    writeFileSync(resolve(out, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`);
  }
  writeFileSync(resolve(out, 'robots.txt'), robots.join('\n') + '\n');

  // 脆弱性の連絡先（RFC 9116）。連絡は GitHub の非公開の脆弱性報告フォームで受け、個人の連絡先は載せない
  if (repo && /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(repo)) {
    const expires = new Date(now.getTime() + 180 * 86400000).toISOString().replace(/\.\d+Z$/, 'Z');
    const lines = [`Contact: https://github.com/${repo}/security/advisories/new`, `Expires: ${expires}`, `Policy: https://github.com/${repo}/blob/main/SECURITY.md`, 'Preferred-Languages: ja, en'];
    if (base) lines.push(`Canonical: ${base}.well-known/security.txt`);
    mkdirSync(resolve(out, '.well-known'), { recursive: true });
    writeFileSync(resolve(out, '.well-known/security.txt'), lines.join('\n') + '\n');
  }
}
