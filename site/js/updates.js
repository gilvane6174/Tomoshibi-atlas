// 更新一覧のページ：「サイトの更新」（data/changelog.json）と「セキュリティ対策」（data/security-log.json）をタブで切り替える。
// 文字はすべて textContent で入れる（HTML として解釈しない）。出典のリンクは https のものだけ（組み立て時に許可リストで検査済み）。
// 外部への通信はしない（同じサイトの JSON だけを読む）。
import { revealResults } from './reveal.js';

const isEn = document.documentElement.lang === 'en';
const locale = isEn ? 'en-GB' : 'ja-JP';
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const pick = (o) => (isEn ? o?.en || o?.ja : o?.ja || o?.en) || '';
const fmt = (iso) => (iso ? new Intl.DateTimeFormat(locale, { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(iso)) : '—');
const getJson = async (p) => {
  const r = await fetch(p, { cache: 'no-cache' });
  if (!r.ok) throw new Error('load');
  return r.json();
};
export function safeUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && !u.username && !u.password ? u.href : null;
  } catch {
    return null;
  }
}

const BY = isEn ? { operator: 'Operator', ai: 'AI assistant (reviewed by the operator)', bot: 'Bot (reviewed by the operator)' } : { operator: '運用者', ai: 'AIによる作業（運用者が確認）', bot: 'ボットによる作業（運用者が確認）' };
export const KIND = {
  incident: { ja: '世の中の事例', en: 'Incident' },
  fix: { ja: '対策・修正', en: 'Fix' },
  audit: { ja: '点検', en: 'Review' },
  policy: { ja: '仕組みの変更', en: 'Platform change' },
};
export const STATUS = {
  done: { ja: '対応済み', en: 'Done' },
  'operator-check': { ja: '運用者が確認中', en: 'Being checked by the operator' },
  proposed: { ja: '提案（取り込み前）', en: 'Proposed (not yet merged)' },
};

// ── タブ（左右の矢印キーでも切り替えられる。URL の #security でセキュリティ対策を開く）──
function setupTabs() {
  const tabs = [...document.querySelectorAll('#upd-tabs [role="tab"]')];
  const show = (tab, focus) => {
    for (const t of tabs) {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      const panel = document.getElementById(t.getAttribute('aria-controls'));
      if (panel) panel.hidden = !on;
    }
    if (focus) tab.focus();
  };
  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => {
      show(tab, false);
      revealResults(tab.getAttribute('aria-controls'), { focus: false });
      try {
        history.replaceState(null, '', tab.id === 'tab-security' ? '#security' : '#site');
      } catch {
        /* 履歴を変えられない環境では何もしない */
      }
    });
    tab.addEventListener('keydown', (ev) => {
      if (ev.key !== 'ArrowRight' && ev.key !== 'ArrowLeft') return;
      ev.preventDefault();
      show(tabs[(i + (ev.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length], true);
    });
  });
  show(location.hash === '#security' ? document.getElementById('tab-security') : tabs[0], false);
}

async function showSiteLog() {
  const target = document.getElementById('changelog');
  try {
    const log = await getJson('data/changelog.json');
    target.replaceChildren();
    const ul = el('ul', 'log-list');
    for (const e of log.entries) {
      const li = el('li');
      li.append(el('span', 'log-date', fmt(e.date)), document.createTextNode(pick(e.summary)), el('span', 'item-meta', isEn ? ` (${BY[e.by.split('-')[0]] || e.by})` : `（${BY[e.by.split('-')[0]] || e.by}）`));
      ul.append(li);
    }
    target.append(ul);
  } catch {
    target.textContent = isEn ? 'The update history could not be loaded.' : '更新履歴を読み込めませんでした。';
  }
}

export function securityItem(e) {
  const li = el('li');
  const head = el('p', 'item-meta');
  head.append(el('span', 'log-date', fmt(e.date)), el('span', `log-kind k-${e.kind}`, pick(KIND[e.kind]) || e.kind), el('span', 'log-kind', pick(STATUS[e.status]) || e.status));
  li.append(head, el('h3', null, pick(e.title)), el('p', null, pick(e.summary)));
  if (e.impact) li.append(el('p', null, (isEn ? 'Impact on this site: ' : 'このサイトへの影響：') + pick(e.impact)));
  if (e.sources?.length) {
    const p = el('p', 'item-meta', isEn ? 'Source: ' : '出典：');
    e.sources.forEach((s, i) => {
      if (i) p.append(document.createTextNode(isEn ? ', ' : '、'));
      const href = s.url ? safeUrl(s.url) : null;
      if (href) {
        const a = el('a', null, s.name);
        a.href = href;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        p.append(a);
      } else p.append(document.createTextNode(s.name));
    });
    li.append(p);
  }
  return li;
}

async function showSecurityLog() {
  const target = document.getElementById('security-log');
  try {
    const log = await getJson('data/security-log.json');
    target.replaceChildren();
    const ul = el('ul', 'log-list');
    for (const e of log.entries) ul.append(securityItem(e));
    target.append(ul);
  } catch {
    target.textContent = isEn ? 'The security record could not be loaded.' : 'セキュリティ対策の記録を読み込めませんでした。';
  }
}

if (typeof document !== 'undefined' && document.getElementById('upd-tabs')) {
  setupTabs();
  showSiteLog();
  showSecurityLog();
}
