// 説明ページに、現在のデータの時点と更新履歴を表示する（文字はすべて textContent で入れる）。

const isEn = document.documentElement.lang === 'en';
const NAMES = isEn
  ? { outbreak: 'Infectious diseases', research: 'Research & Response', mental: 'Mental health', welfare: 'Welfare', security: 'IT security' }
  : { outbreak: '感染症', research: '研究と対策', mental: 'こころ', welfare: '福祉', security: 'ITセキュリティ' };
const BY = isEn ? { operator: 'Operator', ai: 'AI assistant (reviewed by the operator)', bot: 'Bot (reviewed by the operator)' } : { operator: '運用者', ai: 'AIによる作業（運用者が確認）', bot: 'ボットによる作業（運用者が確認）' };
const locale = isEn ? 'en-GB' : 'ja-JP';
const fmt = (iso, time) =>
  iso
    ? new Intl.DateTimeFormat(locale, { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'short', day: 'numeric', ...(time ? { hour: '2-digit', minute: '2-digit' } : {}) }).format(new Date(iso)) +
      (time ? (isEn ? ' (JST)' : '（日本時間）') : '')
    : '—';
const el = (tag, text) => {
  const e = document.createElement(tag);
  if (text != null) e.textContent = text;
  return e;
};
const getJson = async (p) => (await fetch(p, { cache: 'no-cache' })).json();

async function showTime() {
  const target = document.getElementById('data-time');
  try {
    const meta = await getJson('data/meta.json');
    target.replaceChildren();
    if (meta.mode === 'offline') target.append(el('p', isEn ? 'Local review copy built without network access.' : 'ネット接続なしで組み立てたローカル確認版です。'));
    if (meta.mode === 'snapshot') target.append(el('p', isEn ? 'Local review copy: real data checked on official pages.' : 'ローカル確認版：公式ページで確認した実データで表示しています。'));
    const ul = el('ul');
    for (const [id, m] of Object.entries(meta.layers)) {
      const when =
        m.status === 'preparing'
          ? isEn ? 'coming soon' : '準備中'
          : m.status === 'notFetched'
            ? isEn ? 'fetched automatically when published; not in this review copy' : '公開時に自動取得（この確認版では未取得）'
          : m.kind === 'auto'
            ? `${isEn ? 'retrieved' : '取得'} ${fmt(m.retrievedAt, true)}`
            : `${isEn ? 'last reviewed' : '最終確認'} ${fmt(m.reviewedAt)}`;
      ul.append(el('li', `${NAMES[id] || id}: ${m.count}${isEn ? ' items' : '件'} (${when})`));
    }
    target.append(ul);
  } catch {
    target.textContent = isEn ? 'The data date could not be loaded.' : 'データの時点を読み込めませんでした。';
  }
}

async function showLog() {
  const target = document.getElementById('changelog');
  try {
    const log = await getJson('data/changelog.json');
    target.replaceChildren();
    const ul = el('ul');
    for (const e of log.entries.slice(0, 30)) {
      const who = BY[e.by.split('-')[0]] || e.by;
      const text = (isEn ? e.summary.en : e.summary.ja) || e.summary.ja;
      ul.append(el('li', isEn ? `${fmt(e.date)} — ${text} (${who})` : `${fmt(e.date)} — ${text}（${who}）`));
    }
    target.append(ul);
  } catch {
    target.textContent = isEn ? 'The update history could not be loaded.' : '更新履歴を読み込めませんでした。';
  }
}

showTime();
showLog();
