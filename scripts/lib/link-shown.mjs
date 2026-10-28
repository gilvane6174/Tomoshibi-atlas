// リンク集・都道府県の窓口リンクを「サイトに表示するか」の判定（build.mjs と check-links.mjs で同じ条件を使う）。
// 確認の記録（data/directory/evidence.json）があり、方法が fetched（AIが公式ページを開いて確認）か operator（運用者が確認）で、
// 記録の URL が掲載の URL と一致し、確認日があるものだけを表示する。
export const SHOW_METHODS = new Set(['fetched', 'operator']);
export const isShownLink = (link, evidence) => {
  const e = evidence?.[link?.id];
  return Boolean(e && SHOW_METHODS.has(e.method) && e.url === link.url && e.checkedAt);
};
