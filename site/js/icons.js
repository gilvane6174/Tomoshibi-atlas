// 分野の種類を示す小さな印（SVG）。灯＝炎、警鐘＝三角の注意マーク。
// 文字列のHTMLは使わず、createElementNS で組み立てる。

const NS = 'http://www.w3.org/2000/svg';
const PATHS = {
  light: [['path', { d: 'M8 1.6c2.1 2.6 3.1 4.4 3.1 6.1a3.1 3.1 0 0 1-6.2 0C4.9 6 5.9 4.2 8 1.6z', fill: 'currentColor' }], ['path', { d: 'M3.4 12.6a7 2.4 0 0 0 9.2 0', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.2', 'stroke-linecap': 'round', opacity: '.7' }]],
  caution: [['path', { d: 'M8 1.8 14.6 13.6H1.4z', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.5', 'stroke-linejoin': 'round' }], ['path', { d: 'M8 6.2v3.6', stroke: 'currentColor', 'stroke-width': '1.6', 'stroke-linecap': 'round' }], ['circle', { cx: '8', cy: '11.7', r: '.95', fill: 'currentColor' }]],
};

export function groupIcon(group, cls = 'gicon') {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('class', `${cls} ${group}`);
  for (const [tag, attrs] of PATHS[group] || []) {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    svg.append(e);
  }
  return svg;
}
