// 「このサイトの安全対策」のページ：最近の事例と対応（data/security-log.json の新しいもの5件）を表示する。
// 文字はすべて textContent で入れる。外部への通信はしない（同じサイトの JSON だけを読む）。
import { securityItem } from './updates.js';

const isEn = document.documentElement.lang === 'en';

async function showLatest() {
  const target = document.getElementById('latest-security');
  if (!target) return;
  try {
    const r = await fetch('data/security-log.json', { cache: 'no-cache' });
    if (!r.ok) throw new Error('load');
    const log = await r.json();
    target.replaceChildren();
    const ul = document.createElement('ul');
    ul.className = 'log-list';
    for (const e of log.entries.slice(0, 5)) ul.append(securityItem(e));
    target.append(ul);
  } catch {
    target.textContent = isEn ? 'The security record could not be loaded.' : 'セキュリティ対策の記録を読み込めませんでした。';
  }
}

showLatest();
