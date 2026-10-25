// 地球儀の上に浮かぶ文言（国ごとにまとめた見出し）。
// 手前に来た地点だけ表示し、重なる場合は「大きい情報・新しい情報・正面に近い情報」を優先して間引く。
// 文言はすべて textContent で入れる（HTMLとして解釈しない）。

import { t, pick } from './i18n.js';
import { countryName } from './data.js';

export class Labels {
  constructor(container, globe, { onSelect }) {
    this.container = container;
    this.globe = globe;
    this.onSelect = onSelect;
    this.groups = [];
    this.els = new Map();
  }

  // 現在の分野の項目を国ごとにまとめる
  setItems(items, countryMap, layer) {
    const color = layer.color;
    this.group = layer.group;
    const by = new Map();
    // 「以前の情報」は地球儀の見出しには出さない（詳細パネルでのみ薄く表示）
    for (const it of items.filter((x) => !x.superseded)) {
      for (const id of it.countries || []) {
        const c = countryMap.get(id);
        if (!c) continue;
        if (!by.has(id)) by.set(id, { id, lon: c.lon, lat: c.lat, country: c, items: [] });
        by.get(id).items.push(it);
      }
    }
    this.groups = [...by.values()].map((g) => {
      g.items.sort((a, b) => (a.importance === b.importance ? b.publishedAt.localeCompare(a.publishedAt) : a.importance === 'major' ? -1 : 1));
      g.major = g.items[0].importance === 'major';
      g.newest = g.items.reduce((m, it) => (it.publishedAt > m ? it.publishedAt : m), '');
      return g;
    });
    this.color = color;
    for (const el of this.els.values()) el.remove();
    this.els.clear();
    for (const g of this.groups) this.els.set(g.id, this.#make(g));
    this.globe.setDots(this.groups.map((g) => ({ lon: g.lon, lat: g.lat, major: g.major, color, shape: this.group === 'caution' ? 'triangle' : 'dot' })));
    this.update();
  }

  #make(g) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'marker ' + (g.major ? 'major' : 'minor') + (this.group === 'caution' ? ' is-caution' : '');
    el.style.setProperty('--dot', this.color);
    const head = pick(g.items[0].title);
    const title = document.createElement('span');
    title.textContent = `${countryName(g.country)}｜${shorten(head, g.major ? 26 : 20)}`;
    el.append(title);
    if (g.items.length > 1) {
      const more = document.createElement('span');
      more.className = 'more';
      more.textContent = t('label.more', { n: g.items.length - 1 });
      el.append(more);
    }
    el.setAttribute('aria-label', `${countryName(g.country)}: ${head}${g.items.length > 1 ? '、' + t('label.more', { n: g.items.length - 1 }) : ''}`);
    el.addEventListener('click', () => this.onSelect?.(g.id));
    el.hidden = true;
    this.container.append(el);
    return el;
  }

  update() {
    const placed = [];
    const visible = [];
    for (const g of this.groups) {
      const v = this.globe.visibility(g.lon, g.lat);
      const el = this.els.get(g.id);
      if (v === null || v > 0.93) {
        el.hidden = true;
        continue;
      }
      const p = this.globe.project(g.lon, g.lat);
      visible.push({ g, v, p, el });
    }
    // 優先度：大きい情報 → 正面に近い → 新しい
    visible.sort((a, b) => (a.g.major !== b.g.major ? (a.g.major ? -1 : 1) : a.v - b.v || b.g.newest.localeCompare(a.g.newest)));
    const narrow = this.globe.w < 700;
    const limit = narrow ? 7 : 16;
    for (const s of visible) {
      const { el, p } = s;
      if (el.hidden) el.hidden = false; // 一度表示して大きさを測る
      el._w ||= el.offsetWidth;
      el._h ||= el.offsetHeight;
      const ins = this.globe.insets || { left: 0, right: 0 };
      const minX = ins.left + 8;
      const maxX = this.globe.w - ins.right - 8;
      let x = p[0] + 9;
      if (x + el._w > maxX) x = p[0] - 9 - el._w; // 右にはみ出すなら点の左側に出す
      if (x < minX) x = minX;
      const y = p[1] - el._h / 2 - 12;
      if (x + el._w > maxX) {
        el.hidden = true;
        continue;
      }
      const box = [x - 4, y - 3, x + el._w + 4, y + el._h + 3];
      const hit = placed.some((b) => !(box[2] < b[0] || box[0] > b[2] || box[3] < b[1] || box[1] > b[3]));
      if (hit || placed.length >= limit) {
        el.hidden = true;
        continue;
      }
      placed.push(box);
      el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
      el.style.opacity = String(Math.max(0.25, 1 - Math.pow(s.v, 3)));
    }
  }
}

const shorten = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
