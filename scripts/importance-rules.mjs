// 文字の大小（major / minor）を決める固定ルール。
// これは「深刻度」ではなく「新しさと公的区分」による表示上の目立たせ方。
// ルールを変えた場合は site/about.html の「表示ルール」も必ず同じ内容に更新すること。

const DAY = 86400000;
const ageDays = (iso, now) => (now - new Date(iso).getTime()) / DAY;

// keepDays … 通常の掲載期間。fillDays … 件数が少ないときに、小さな文字で補って表示してよい古さの上限
export const RULES = {
  // 感染症（WHO疾病発生ニュース）：直近14日以内の公表を大きく表示
  outbreak: { majorWithinDays: 14, keepDays: 120, fillDays: 730 },
  // セキュリティ（CISA KEV）：直近30日の追加分。ランサムウェアでの悪用が「Known」なら大きく表示
  securityKev: { keepDays: 30, fillDays: 365 },
  // セキュリティ（JPCERT/CC 注意喚起）：直近30日の注意喚起はすべて大きく表示
  securityJpcert: { keepDays: 30, fillDays: 365 },
  // 地震（USGS）：直近7日以内を大きく表示。過去30日のM5.5以上を新しい順に（専用の分野なので、ほかの情報を押し流さない）
  quake: { majorWithinDays: 7, keepDays: 30 },
  // 防犯（詐欺・闇バイトなどの注意喚起）と防災（災害の被害状況）：通常の掲載は90日以内。足りないときは180日以内で補う
  crime: { keepDays: 90, fillDays: 180 },
  disaster: { keepDays: 90, fillDays: 180 },
};

// 件数の上限を分野ごとに変える場合（2026-10-26 から全分野30件にそろえたため、今は個別の指定なし）
export const MAX_BY_LAYER = {};

// 各分野の表示件数（「以前の情報」を除く）：多すぎず少なすぎないように、20〜30件にそろえる。
//   1. 掲載期間内（keepDays。手動掲載の分野は期間なし）の情報を、新しい順に最大30件（MAX_BY_LAYER で分野ごとに変えられる）
//   2. それが20件に満たないときは、掲載期間を過ぎた情報（fillDays 以内）を新しい順に補い、20件にする（小さな文字で表示）
//      自動取得の分野は取得の段階で fillDays より古いものを除く。手動掲載の分野で上限が要るものは fitCount の fillDays で渡す
//   3. 新しい情報が入ると、古いものから順に表示から外れる（データ自体は残る）
// 「以前の情報」（supersede）は、それを置き換えた新しい情報を表示しているときだけ残す。
export const SHOW = { min: 20, max: 30 };
const newest = (a, b) => b.publishedAt.localeCompare(a.publishedAt) || a.id.localeCompare(b.id);
export function fitCount(items, keepDays = null, now = Date.now(), max = SHOW.max, fillDays = null) {
  const sorted = [...items].sort(newest);
  const active = sorted.filter((it) => !it.superseded);
  const recent = keepDays == null ? active : active.filter((it) => withinDays(it.publishedAt, keepDays, now));
  const chosen = recent.slice(0, max);
  if (chosen.length < SHOW.min) {
    const picked = new Set(chosen);
    for (const it of active) {
      if (chosen.length >= SHOW.min) break;
      if (picked.has(it) || (fillDays != null && !withinDays(it.publishedAt, fillDays, now))) continue;
      chosen.push({ ...it, importance: 'minor', older: true });
    }
  }
  const ids = new Set(chosen.map((it) => it.id));
  return [...chosen, ...sorted.filter((it) => it.superseded && ids.has(it.supersededBy))].sort(newest);
}

export function outbreakImportance(publishedAt, now = Date.now()) {
  return ageDays(publishedAt, now) <= RULES.outbreak.majorWithinDays ? 'major' : 'minor';
}

export function kevImportance(ransomwareUse) {
  return ransomwareUse === 'Known' ? 'major' : 'minor';
}

export const jpcertImportance = () => 'major';

export const withinDays = (iso, days, now = Date.now()) => ageDays(iso, now) <= days;
