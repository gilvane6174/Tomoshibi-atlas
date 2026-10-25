// 「同じ分野・同じ地域・同じ話題」の情報が複数あるとき、最新のもの以外を「以前の情報」として扱う。
// 以前の情報は、公表日から7日間だけ表示し（すぐには消さない）、それを過ぎたら掲載しない。
// 画面では「以前の情報（より新しい公表あり）」と明示し、最新情報と誤解されないようにする。

export const KEEP_SUPERSEDED_DAYS = 7;
const DAY = 86400000;

// 同じ分野・同じ話題で、より新しい項目の対象国が古い項目の対象国をすべて含む場合に、古い項目を「以前の情報」とする。
// （例：COD だけの発表 → COD・KEN・NGA を含む続報で置き換え。COD・UGA の発表は UGA が続報に無いので残す）
const covers = (newer, older) => {
  const a = newer.countries || [];
  const b = older.countries || [];
  if (b.length === 0) return a.length === 0;
  return b.every((c) => a.includes(c));
};

export function applySupersede(items, now = Date.now()) {
  const byTopic = new Map();
  const out = [];
  for (const it of items) {
    if (!it.topic) {
      out.push({ ...it });
      continue;
    }
    const key = `${it.layer}|${it.topic}`;
    if (!byTopic.has(key)) byTopic.set(key, []);
    byTopic.get(key).push(it);
  }
  for (const list of byTopic.values()) {
    list.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || a.id.localeCompare(b.id));
    list.forEach((it, i) => {
      const newer = list.slice(0, i).find((n) => n.publishedAt > it.publishedAt && covers(n, it));
      if (!newer) return out.push({ ...it });
      const ageDays = (now - new Date(it.publishedAt).getTime()) / DAY;
      if (ageDays <= KEEP_SUPERSEDED_DAYS) out.push({ ...it, superseded: true, supersededBy: newer.id, importance: 'minor' });
    });
  }
  return out.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || a.id.localeCompare(b.id));
}
