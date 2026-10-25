// 国・地域の検索。サイト内の国名索引だけで処理し、入力内容を外部へ送らない。

import { t } from './i18n.js';
import { countryName } from './data.js';

const norm = (s) => s.normalize('NFKC').toLowerCase().replace(/[\s・･]/g, '');
// ひらがな → カタカナ（「けにあ」でも「ケニア」に当たるように）
const kata = (s) => s.replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));

export function setupSearch(input, list, countries, onChoose) {
  const index = countries.map((c) => ({ c, keys: [norm(c.ja), norm(c.enName || ''), ...c.en.map(norm)].filter(Boolean) }));
  let results = [];
  let active = -1;

  const close = () => {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    active = -1;
  };
  const choose = (c) => {
    input.value = countryName(c);
    close();
    onChoose(c);
  };
  const render = () => {
    list.replaceChildren();
    if (!results.length) {
      const li = document.createElement('li');
      li.textContent = t('search.none');
      li.setAttribute('aria-disabled', 'true');
      list.append(li);
    }
    results.forEach((c, i) => {
      const li = document.createElement('li');
      li.setAttribute('role', 'option');
      li.id = 'sr-' + c.id;
      li.setAttribute('aria-selected', String(i === active));
      const ja = document.createElement('span');
      ja.textContent = countryName(c);
      const en = document.createElement('span');
      en.className = 'en';
      en.textContent = countryName(c) === c.ja ? c.enName || c.en[0] || '' : c.ja;
      li.append(ja, en);
      li.addEventListener('mousedown', (e) => {
        e.preventDefault();
        choose(c);
      });
      list.append(li);
    });
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    if (active >= 0) input.setAttribute('aria-activedescendant', 'sr-' + results[active].id);
    else input.removeAttribute('aria-activedescendant');
  };

  input.addEventListener('input', () => {
    const q = kata(norm(input.value));
    if (!q) return close();
    const starts = [];
    const contains = [];
    for (const { c, keys } of index) {
      if (keys.some((k) => k.startsWith(q))) starts.push(c);
      else if (keys.some((k) => k.includes(q))) contains.push(c);
    }
    results = [...starts, ...contains].slice(0, 8);
    active = results.length ? 0 : -1;
    render();
  });
  input.addEventListener('keydown', (e) => {
    if (list.hidden) return;
    if (e.key === 'ArrowDown') active = Math.min(results.length - 1, active + 1);
    else if (e.key === 'ArrowUp') active = Math.max(0, active - 1);
    else if (e.key === 'Enter' && results[active]) return choose(results[active]);
    else if (e.key === 'Escape') return close();
    else return;
    e.preventDefault();
    render();
  });
  input.addEventListener('blur', () => setTimeout(close, 120));
}
