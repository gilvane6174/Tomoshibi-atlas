// セキュリティ関連の公的情報を取得し、表示用の項目に変換する。
// 位置は「発表した機関の所在国」に置く（攻撃の発生地点や攻撃元を示すものではない）。

import './lib/node-guard.mjs';
import { fetchJson, fetchText } from './lib/http.mjs';
import { cleanText, stripTags, isValidDate, toIsoDate, isAllowedUrl, readJson } from './lib/safety.mjs';
import { kevImportance, jpcertImportance, withinDays, RULES } from './importance-rules.mjs';

const { fetchEndpoints, enabledFetchers } = readJson('scripts/allowed-sources.json');
const CVE = /^CVE-\d{4}-\d{4,7}$/;

export function normalizeKev(v, now = Date.now()) {
  const cve = typeof v.cveID === 'string' ? v.cveID.trim() : '';
  if (!CVE.test(cve) || !isValidDate(v.dateAdded)) return null;
  // 悪用予防：対処方法（修正版の適用・回避策など）が示されていないものは載せない（ops/CURATION.md「対策の公表を待つ」）
  if (!cleanText(stripTags(v.requiredAction || ''), 400)) return null;
  const publishedAt = toIsoDate(v.dateAdded);
  if (!withinDays(publishedAt, RULES.securityKev.fillDays, now)) return null;
  const vendor = cleanText(stripTags(v.vendorProject || ''), 80);
  const product = cleanText(stripTags(v.product || ''), 80);
  const name = cleanText(stripTags(v.vulnerabilityName || ''), 200);
  const url = `https://nvd.nist.gov/vuln/detail/${cve}`;
  if (!isAllowedUrl(url)) return null;
  const ransomware = v.knownRansomwareCampaignUse === 'Known';
  return {
    id: 'kev-' + cve.toLowerCase(),
    layer: 'security',
    title: {
      ja: `悪用確認済みの脆弱性：${vendor} ${product}`.trim(),
      en: `Known exploited vulnerability: ${vendor} ${product}`.trim(),
      original: `${cve} ${name}`.trim(),
    },
    tags: ransomware ? ['ransomware'] : [],
    countries: ['USA'],
    placeBasis: 'publisher_country',
    importance: kevImportance(v.knownRansomwareCampaignUse),
    publishedAt,
    source: { name: 'CISA Known Exploited Vulnerabilities Catalog', url: 'https://www.cisa.gov/known-exploited-vulnerabilities-catalog' },
    links: [{ label: `NVD：${cve}`, url }],
  };
}

async function fetchKev() {
  // 本来の配布元（cisa.gov）が一時的に取れないときだけ、CISA 自身が GitHub で公開している同じデータ（cisagov/kev-data）を使う
  let data;
  try {
    data = await fetchJson(fetchEndpoints.cisaKev);
  } catch {
    data = await fetchJson(fetchEndpoints.cisaKevMirror);
  }
  const list = data?.vulnerabilities;
  if (!Array.isArray(list)) throw new Error('CISA KEV: unexpected response shape');
  if (list.length < 500) throw new Error(`CISA KEV: too few entries (${list.length}) — 異常とみなして公開を中止`);
  return list.map((v) => normalizeKev(v)).filter(Boolean);
}

// JPCERT/CC の RSS 1.0（RDF）から item の title/link/dc:date だけを取り出す。
// 汎用XMLパーサは使わず、必要な要素だけを厳格な正規表現で抜く。DOCTYPE/ENTITY を含む応答は拒否。
export function parseJpcertRdf(xml, now = Date.now()) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('JPCERT RSS: DOCTYPE/ENTITY is not allowed');
  const items = [];
  const decode = (s) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&');
  const pick = (block, tag) => {
    const m = block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
    return m ? decode(m[1]).trim() : '';
  };
  for (const m of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/g)) {
    const title = cleanText(stripTags(pick(m[1], 'title')), 200);
    const raw = pick(m[1], 'link');
    const date = pick(m[1], 'dc:date');
    if (!title || !isAllowedUrl(raw) || !isValidDate(date)) continue;
    const u = new URL(raw); // URL として正規化（../ などを解決）してから判定する
    if (u.hostname !== 'www.jpcert.or.jp') continue;
    // 注意喚起（/at/年/…）だけを対象にする
    if (!/^\/at\/\d{4}\/[a-z0-9_-]+\.html$/i.test(u.pathname)) continue;
    const link = u.origin + u.pathname;
    const publishedAt = toIsoDate(date);
    if (!withinDays(publishedAt, RULES.securityJpcert.fillDays, now)) continue;
    items.push({
      id: 'jpcert-' + u.pathname.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase(),
      layer: 'security',
      title: { ja: title }, // JPCERT/CC の見出しは日本語のみ。英語表示では「日本語のみ」と明示する
      countries: ['JPN'],
      placeBasis: 'publisher_country',
      importance: jpcertImportance(),
      publishedAt,
      source: { name: 'JPCERT/CC 注意喚起', url: link },
    });
  }
  return items;
}

async function fetchJpcert() {
  return parseJpcertRdf(await fetchText(fetchEndpoints.jpcertRss));
}

export async function fetchSecurity() {
  const out = [];
  if (enabledFetchers.cisaKev) out.push(...(await fetchKev()));
  if (enabledFetchers.jpcertRss) out.push(...(await fetchJpcert()));
  out.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  return out;
}
