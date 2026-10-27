// RSS 2.0・RSS 1.0（RDF）・Atom の「見出し・リンク・日付」だけを取り出す小さな読み取り器。
// 汎用XMLパーサは使わず、必要な要素だけを厳格な正規表現で抜く。DOCTYPE/ENTITY を含む応答は拒否する
// （外部実体の読み込みや展開による攻撃を避けるため）。本文（description など）は読まない。

const MAX_ITEMS = 100;

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function decode(s) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
      if (e[0] === '#') {
        const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
      }
      return ENT[e.toLowerCase()] ?? m;
    });
}

const tag = (block, name) => {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i').exec(block);
  return m ? decode(m[1]).trim() : '';
};

// 日付：RFC 822（RSS 2.0）・ISO 8601（RSS 1.0 / Atom）。「JST」の文字表記は +0900 として読む
export function parseFeedDate(s) {
  if (typeof s !== 'string' || !s.trim()) return null;
  // NIH の RSS は「Fri, 10/23/2026 - 13:00」（月/日/年。時間帯の表記なし）の形。日付だけを使い、日付がずれないよう UTC の正午とする
  const us = /^(?:[A-Za-z]{3},\s*)?(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s*-\s*\d{1,2}:\d{2})?$/.exec(s.trim());
  if (us) {
    const [mo, d, y] = [Number(us[1]), Number(us[2]), Number(us[3])];
    const t = Date.UTC(y, mo - 1, d, 12);
    return mo >= 1 && mo <= 12 && new Date(t).getUTCDate() === d ? t : null;
  }
  const t = Date.parse(s.trim().replace(/\bJST$/i, '+0900'));
  return Number.isFinite(t) ? t : null;
}

export function parseFeed(xml) {
  if (typeof xml !== 'string') throw new Error('feed: not text');
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('feed: DOCTYPE/ENTITY is not allowed');
  const out = [];
  const isAtom = /<feed[\s>]/i.test(xml) && /<entry[\s>]/i.test(xml);
  const re = isAtom ? /<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/gi : /<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi;
  if (!isAtom && !/<(rss|rdf:RDF)[\s>]/i.test(xml)) throw new Error('feed: not RSS or Atom');
  for (const m of xml.matchAll(re)) {
    if (out.length >= MAX_ITEMS) break;
    const b = m[1];
    let link = '';
    if (isAtom) {
      const l = /<link\b[^>]*\brel=["']alternate["'][^>]*>/i.exec(b) || /<link\b[^>]*>/i.exec(b);
      link = l ? decode(/\bhref=["']([^"']+)["']/i.exec(l[0])?.[1] || '') : '';
    } else link = tag(b, 'link') || decode(/<guid[^>]*isPermaLink=["']true["'][^>]*>([\s\S]*?)<\/guid>/i.exec(b)?.[1] || '');
    const date = isAtom ? tag(b, 'published') || tag(b, 'updated') : tag(b, 'pubDate') || tag(b, 'dc:date');
    out.push({ title: tag(b, 'title'), link: link.trim(), date: parseFeedDate(date) });
  }
  return out;
}
