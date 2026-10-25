// 文字の大小（major / minor）を決める固定ルール。
// これは「深刻度」ではなく「新しさと公的区分」による表示上の目立たせ方。
// ルールを変えた場合は site/about.html の「表示ルール」も必ず同じ内容に更新すること。

const DAY = 86400000;
const ageDays = (iso, now) => (now - new Date(iso).getTime()) / DAY;

export const RULES = {
  // 感染症（WHO疾病発生ニュース）：直近14日以内の公表を大きく表示
  outbreak: { majorWithinDays: 14, keepDays: 120 },
  // セキュリティ（CISA KEV）：直近30日の追加分のみ。ランサムウェアでの悪用が「Known」なら大きく表示
  securityKev: { keepDays: 30 },
  // セキュリティ（JPCERT/CC 注意喚起）：直近30日の注意喚起はすべて大きく表示
  securityJpcert: { keepDays: 30 },
};

export function outbreakImportance(publishedAt, now = Date.now()) {
  return ageDays(publishedAt, now) <= RULES.outbreak.majorWithinDays ? 'major' : 'minor';
}

export function kevImportance(ransomwareUse) {
  return ransomwareUse === 'Known' ? 'major' : 'minor';
}

export const jpcertImportance = () => 'major';

export const withinDays = (iso, days, now = Date.now()) => ageDays(iso, now) <= days;
