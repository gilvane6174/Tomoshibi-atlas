// 画面下の「件数と取得状態」の文言を決める（画面の部品に触らない純粋な関数。scripts/test.mjs で検査する）。
//
// 自動取得の見出しと手動掲載が混ざる分野（mixed：防犯・防災など）では、
//   - 見出しの取得時刻と、手動掲載の最終確認日を分けて示す
//   - 取得元の一部だけが失敗・異常のときも、成功した取得元があるかどうかに関係なく、失敗した取得元を知らせる
//     （正常な0件＝empty は失敗として扱わない。公開版（live）以外では取得していないので知らせない）
//   - 取得に失敗した取得元の、前回の値や時刻を「取得成功」として示さない（取得時刻は build.mjs が ok / empty のときだけ付ける）

const FAILED = new Set(['failed', 'invalid']);

// 戻り値：{ key, params, notes } … key と params で本文、notes は後ろに付ける注意（翻訳キーと値）
export function statusModel({ layer, doc, meta, mode, now = Date.now() }) {
  const m = meta || {};
  const notes = [];
  // 公開版で、取得元の一部（または全部）が失敗・異常（件数が0件の場合も含めて、いつも知らせる）
  const failed = mode === 'live' && m.kind === 'mixed' ? Object.entries(m.feeds || {}).filter(([, f]) => FAILED.has(f?.status)).map(([k]) => k) : [];
  const failNote = failed.length ? [{ key: 'status.feedsMissing', sources: failed }] : [];
  if (doc?.status === 'notFetched') return { key: 'status.notFetchedShort', params: { layer }, notes: failNote };
  if (doc?.status === 'fetchFailed') return { key: 'status.fetchFailedShort', params: { layer }, notes: failNote };
  if (doc?.status === 'preparing') return { key: 'status.preparingShort', params: { layer }, notes: failNote };

  let out;
  if (m.kind === 'auto') out = { key: 'status.live', params: { layer, count: m.count, date: m.retrievedAt } };
  else if (m.kind === 'mixed' && m.retrievedAt) out = { key: 'status.mixed', params: { layer, count: m.count, date: m.retrievedAt, reviewed: m.reviewedAt } };
  else if (m.kind === 'daily') out = { key: 'status.daily', params: { layer, count: m.count } };
  else out = { key: 'status.curated', params: { layer, count: m.count, date: m.reviewedAt } };

  // 公開版で自動取得が2日以上止まっている
  if (mode === 'live' && (m.kind === 'auto' || m.kind === 'mixed') && m.retrievedAt && now - Date.parse(m.retrievedAt) > 48 * 3600000) notes.push({ key: 'status.stale' });
  notes.push(...failNote);
  return { ...out, notes };
}
