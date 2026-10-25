// 表示データの読み込みと、分野（レイヤー）の定義。
// 読み込むのは同じサイト内の JSON だけ（CSP で外部通信は禁止している）。

import { lang, t } from './i18n.js';

export const LAYERS = [
  { id: 'outbreak', group: 'light', color: '#f0b45a' },
  { id: 'research', group: 'light', color: '#6cc9b8' },
  { id: 'mental', group: 'light', color: '#aaa2ee' },
  { id: 'welfare', group: 'light', color: '#9ccf8c' },
  { id: 'security', group: 'caution', color: '#ee8593' },
];
export const layerById = (id) => LAYERS.find((l) => l.id === id);

async function getJson(path) {
  const res = await fetch(path, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`load failed: ${path}`);
  return res.json();
}

export async function loadAll() {
  // 公式リンク集は補助情報。読めなくても地球儀は表示する
  const dirP = getJson('data/directory.json').catch(() => null);
  const [meta, countries, shapes, ...layerDocs] = await Promise.all([
    getJson('data/meta.json'),
    getJson('data/geo/country-index.json'),
    getJson('data/geo/countries-110m.json'),
    ...LAYERS.map((l) => getJson(`data/layers/${l.id}.json`)),
  ]);
  const layers = {};
  LAYERS.forEach((l, i) => (layers[l.id] = layerDocs[i]));
  const countryMap = new Map(countries.map((c) => [c.id, c]));
  const directory = await dirP;
  return { meta, countries, countryMap, shapes, layers, directory };
}

export const countryName = (c) => (c ? (lang === 'en' ? c.enName || c.en[0] : c.ja) : '');

// 外部リンクは https のみ許可（ビルド時にも許可リスト検査済み。ここは二重の安全策）
export function safeHttpsUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && !u.username && !u.password ? u.href : null;
  } catch {
    return null;
  }
}

const locale = () => (lang === 'en' ? 'en-GB' : 'ja-JP');
export const formatDate = (iso) =>
  iso ? new Intl.DateTimeFormat(locale(), { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(iso)) : '—';
export const formatDateTime = (iso) =>
  iso
    ? new Intl.DateTimeFormat(locale(), { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)) +
      (lang === 'en' ? ' (JST)' : '（日本時間）')
    : '—';

// 公表からの経過日数（日本時間の日付で数える）
export function ageDays(iso) {
  const day = (d) => Math.floor((new Date(d).getTime() + 9 * 3600000) / 86400000);
  return Math.max(0, day(Date.now()) - day(iso));
}
export const ageLabel = (iso) => {
  const n = ageDays(iso);
  return n < 1 ? t('age.today') : t('age.days', { n });
};
