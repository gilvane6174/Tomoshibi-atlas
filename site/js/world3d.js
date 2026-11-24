// 「3Dで見る世界」：世界銀行の指標（data/compare.json）から3つを選び、国・地域を3次元の点として描く。
// 外部のライブラリを使わない（canvas の2D描画で、回転と遠近を自前で計算する。軽く、点検しやすいように）。
// 文字はすべて textContent で入れる。外部への通信はしない（同じサイトの JSON だけを読む）。
// 値の無い国は描かない（推計で埋めない）。点の位置は「並べて眺める」ためのもので、因果関係を示すものではない。

const isEn = typeof document !== 'undefined' && document.documentElement.lang === 'en';
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const pick = (o) => (isEn ? o?.en || o?.ja : o?.ja || o?.en) || '';
const L = isEn
  ? { x: 'Left–right axis', y: 'Up–down axis', z: 'Front–back axis', rotate: 'Stop rotating', rotateOn: 'Rotate', reset: 'Reset view', zoomIn: 'Zoom in', zoomOut: 'Zoom out', none: 'Select a point to see its values.', count: (n) => `${n} countries and areas have values for all three.`, notFetched: 'This preview has not retrieved the figures (they are retrieved when the site is published).', sample: 'Try with sample values', sampleNote: 'Sample values for checking how the view works. These are NOT real statistics.', loadFail: 'The data could not be loaded. Please try again later.', tooFew: 'Fewer than three indicators are available right now.', log: ' (log scale)', country: 'Country / area', year: 'year' }
  : { x: '左右の軸', y: '上下の軸', z: '奥行きの軸', rotate: '回転を止める', rotateOn: '回転する', reset: '最初の向きに戻す', zoomIn: '近づける', zoomOut: '遠ざける', none: '点を選ぶと、その国の値を表示します。', count: (n) => `3つの値がそろっている国・地域：${n}`, notFetched: 'この確認版では値を取得していません（公開時に取得します）。', sample: '見本の値で動きを確かめる', sampleNote: '動きを確かめるための見本の値です。実際の統計ではありません。', loadFail: 'データを読み込めませんでした。時間をおいて、もう一度お試しください。', tooFew: '今は3つ以上の指標がそろっていません。', log: '（対数目盛り）', country: '国・地域', year: '年' };

const fmtNum = (v, ind) => {
  const s = new Intl.NumberFormat(isEn ? 'en-GB' : 'ja-JP', { maximumFractionDigits: ind.decimals, minimumFractionDigits: ind.decimals }).format(v);
  return ind.unit === '%' ? `${s}%` : ind.unit === 'intl$' ? (isEn ? `$${s}` : `${s}国際ドル`) : s;
};

// 値を -1〜1 にならす。お金の指標（国際ドル）は桁が大きく違うため対数にする
export function makeScale(values, unit) {
  const useLog = unit === 'intl$';
  const f = (v) => (useLog ? Math.log10(Math.max(v, 1)) : v);
  const xs = values.map(f);
  let min = Math.min(...xs);
  let max = Math.max(...xs);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { f: () => 0, useLog };
  if (max === min) max = min + 1;
  return { f: (v) => ((f(v) - min) / (max - min)) * 2 - 1, useLog };
}

// 3次元の点を回転して、画面の座標に直す（yaw：左右の回転、pitch：上下の傾き、dist：視点までの距離）
export function project([x, y, z], { yaw, pitch, dist, w, h }) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  const x1 = x * cy + z * sy;
  const z1 = -x * sy + z * cy;
  const y2 = y * cp - z1 * sp;
  const z2 = y * sp + z1 * cp;
  const s = (Math.min(w, h) * 0.42 * dist) / (dist + z2 + 2);
  return { sx: w / 2 + x1 * s, sy: h / 2 - y2 * s, depth: z2, s };
}

// 見本の値（確認版で動きを確かめるためだけ。実際の統計ではないことを画面に必ず出す）
function sampleData(countries) {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const mk = (key, unit, decimals, ja, en, lo, hi) => {
    const values = {};
    for (const c of countries.slice(0, 120)) values[c.id] = [Number((lo + rnd() * (hi - lo)).toFixed(decimals)), 2024];
    return { key, unit, decimals, status: 'ok', name: { ja: `見本の値 ${ja}`, en: `Sample ${en}` }, values, count: Object.keys(values).length, sample: true };
  };
  return [mk('s1', 'intl$', 0, 'A', 'A', 800, 120000), mk('s2', '', 1, 'B', 'B', 20, 60), mk('s3', '%', 1, 'C', 'C', 0, 80)];
}

function start(data, countries) {
  const canvas = document.getElementById('w3d-canvas');
  const ctx = canvas.getContext('2d');
  const info = document.getElementById('w3d-info');
  const note = document.getElementById('w3d-note');
  const sel = { x: document.getElementById('w3d-x'), y: document.getElementById('w3d-y'), z: document.getElementById('w3d-z') };
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const view = { yaw: -0.7, pitch: 0.35, dist: 3.2, auto: !reduce, picked: null };
  let inds = [];
  let points = [];
  let drawn = [];

  const nameOf = (id) => {
    const c = countries.find((x) => x.id === id);
    return c ? (isEn ? c.enName || c.en?.[0] || c.id : c.ja || c.id) : id;
  };

  function setIndicators(list) {
    inds = list.filter((x) => x.status === 'ok' && x.count > 0);
    for (const s of Object.values(sel)) {
      s.replaceChildren();
      inds.forEach((ind, i) => {
        const o = el('option', null, pick(ind.name) + (ind.unit === 'intl$' ? L.log : ''));
        o.value = String(i);
        s.append(o);
      });
      s.disabled = inds.length < 3;
    }
    const pref = ['wbGdpPpp', 'wbGini', 'wbPoverty'];
    const idx = pref.map((k) => inds.findIndex((x) => x.key === k));
    const def = idx.every((i) => i >= 0) ? idx : [0, 1, 2];
    sel.x.value = String(def[0]);
    sel.y.value = String(def[1]);
    sel.z.value = String(def[2]);
    rebuild();
  }

  function rebuild() {
    view.picked = null;
    info.textContent = L.none;
    if (inds.length < 3) {
      points = [];
      note.textContent = L.tooFew;
      draw();
      fillTable([]);
      return;
    }
    const ax = [sel.x, sel.y, sel.z].map((s) => inds[Number(s.value)]);
    const ids = Object.keys(ax[0].values).filter((id) => ax[1].values[id] && ax[2].values[id]);
    const scales = ax.map((ind) => makeScale(ids.map((id) => ind.values[id][0]), ind.unit));
    points = ids.map((id) => ({ id, name: nameOf(id), raw: ax.map((ind) => ind.values[id]), p: ax.map((ind, k) => scales[k].f(ind.values[id][0])) }));
    note.textContent = (ax.some((x) => x.sample) ? L.sampleNote + ' ' : '') + L.count(points.length);
    draw();
    fillTable(ax);
  }

  function fillTable(ax) {
    const wrap = document.getElementById('w3d-table');
    wrap.replaceChildren();
    if (!points.length) return;
    const table = el('table', 'cmp-table');
    const tr = el('tr');
    tr.append(el('th', null, L.country), ...ax.map((ind) => el('th', null, pick(ind.name))));
    const thead = el('thead');
    thead.append(tr);
    const tbody = el('tbody');
    for (const pt of [...points].sort((a, b) => a.name.localeCompare(b.name, isEn ? 'en' : 'ja'))) {
      const r = el('tr');
      r.append(el('td', null, pt.name), ...pt.raw.map(([v, y], k) => el('td', null, `${fmtNum(v, ax[k])}（${y}${isEn ? '' : L.year}）`)));
      tbody.append(r);
    }
    table.append(thead, tbody);
    wrap.append(table);
  }

  // canvas の大きさは、表示の大きさが変わったときだけ設定し直す（毎回の設定は、描き直しを重くするため）
  function size() {
    const r = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = Math.max(1, Math.round(r.width * dpr));
    const H = Math.max(1, Math.round(r.height * dpr));
    if (canvas.width !== W || canvas.height !== H) {
      canvas.width = W;
      canvas.height = H;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { w: r.width, h: r.height };
  }

  function draw() {
    const { w, h } = size();
    const v = { ...view, w, h };
    ctx.clearRect(0, 0, w, h);
    // 箱（立方体の12本の辺）と軸の名前
    const c = [-1, 1];
    const corners = [];
    for (const x of c) for (const y of c) for (const z of c) corners.push([x, y, z]);
    ctx.strokeStyle = 'rgba(159, 179, 200, 0.28)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 8; i++)
      for (let j = i + 1; j < 8; j++) {
        const d = corners[i].reduce((n, val, k) => n + (val !== corners[j][k] ? 1 : 0), 0);
        if (d !== 1) continue;
        const a = project(corners[i], v), b = project(corners[j], v);
        ctx.beginPath();
        ctx.moveTo(a.sx, a.sy);
        ctx.lineTo(b.sx, b.sy);
        ctx.stroke();
      }
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(230, 235, 242, 0.85)';
    const axisLabel = [[1.15, -1, -1, 'X'], [-1, 1.15, -1, 'Y'], [-1, -1, 1.15, 'Z']];
    for (const [x, y, z, t] of axisLabel) {
      const p = project([x, y, z], v);
      ctx.fillText(t, p.sx, p.sy);
    }
    // 点（奥のものから描く）。日本は暖かい色、選んだ点は白で縁取り
    drawn = points.map((pt) => ({ pt, ...project(pt.p, v) })).sort((a, b) => b.depth - a.depth);
    for (const d of drawn) {
      const r = Math.max(2, 3.2 * (d.s / (Math.min(w, h) * 0.42)));
      ctx.beginPath();
      ctx.arc(d.sx, d.sy, r, 0, Math.PI * 2);
      ctx.fillStyle = d.pt.id === 'JPN' ? '#f2c27a' : 'rgba(134, 182, 234, 0.85)';
      ctx.fill();
      if (view.picked === d.pt.id) {
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();
        ctx.fillStyle = '#ffffff';
        ctx.fillText(d.pt.name, d.sx + 8, d.sy - 6);
      }
    }
  }

  function showInfo(pt) {
    const ax = [sel.x, sel.y, sel.z].map((s) => inds[Number(s.value)]);
    info.textContent = `${pt.name}：` + pt.raw.map(([val, y], k) => `${['X', 'Y', 'Z'][k]} ${pick(ax[k].name)} ${fmtNum(val, ax[k])}（${y}${isEn ? '' : L.year}）`).join(isEn ? ' / ' : '／');
  }

  // 操作：ドラッグで回転、点を押すと値を表示、矢印キーで回転、＋−で拡大縮小
  let drag = null;
  canvas.addEventListener('pointerdown', (e) => {
    drag = { x: e.clientX, y: e.clientY, moved: false };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    view.yaw += dx * 0.01;
    view.pitch = Math.max(-1.4, Math.min(1.4, view.pitch + dy * 0.01));
    drag.x = e.clientX;
    drag.y = e.clientY;
    draw();
  });
  canvas.addEventListener('pointerup', (e) => {
    if (drag && !drag.moved) {
      const r = canvas.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      let best = null, bd = 14 * 14;
      for (const d of drawn) {
        const dd = (d.sx - x) ** 2 + (d.sy - y) ** 2;
        if (dd < bd) (bd = dd), (best = d.pt);
      }
      view.picked = best ? best.id : null;
      if (best) showInfo(best);
      else info.textContent = L.none;
      draw();
    }
    drag = null;
  });
  canvas.addEventListener('keydown', (e) => {
    const k = e.key;
    if (k === 'ArrowLeft') view.yaw -= 0.1;
    else if (k === 'ArrowRight') view.yaw += 0.1;
    else if (k === 'ArrowUp') view.pitch = Math.max(-1.4, view.pitch - 0.1);
    else if (k === 'ArrowDown') view.pitch = Math.min(1.4, view.pitch + 0.1);
    else if (k === '+' || k === '=') view.dist = Math.min(8, view.dist + 0.3);
    else if (k === '-') view.dist = Math.max(1.6, view.dist - 0.3);
    else return;
    e.preventDefault();
    draw();
  });
  const rot = document.getElementById('w3d-rotate');
  const syncRot = () => (rot.textContent = view.auto ? L.rotate : L.rotateOn);
  rot.addEventListener('click', () => {
    view.auto = !view.auto;
    syncRot();
    if (view.auto) startLoop();
  });
  document.getElementById('w3d-reset').addEventListener('click', () => {
    Object.assign(view, { yaw: -0.7, pitch: 0.35, dist: 3.2 });
    draw();
  });
  document.getElementById('w3d-zoom-in').addEventListener('click', () => ((view.dist = Math.min(8, view.dist + 0.4)), draw()));
  document.getElementById('w3d-zoom-out').addEventListener('click', () => ((view.dist = Math.max(1.6, view.dist - 0.4)), draw()));
  for (const s of Object.values(sel)) s.addEventListener('change', rebuild);
  window.addEventListener('resize', draw);
  // 自動の回転は、3Dの図が画面に見えているときだけ・動きを減らす設定のときは最初から止める。
  // 描画の予約は1本だけ（止める・再開をくり返しても、描画が二重に走らない）
  let raf = 0;
  let onScreen = true;
  if ('IntersectionObserver' in window) {
    new IntersectionObserver((es) => {
      onScreen = es.some((e) => e.isIntersecting);
      if (onScreen) startLoop();
    }).observe(canvas);
  }
  function tick() {
    raf = 0;
    if (!view.auto || document.hidden || !onScreen || canvas.offsetParent === null) return; // 止まったら予約しない（見えたら startLoop で再開）
    if (!drag) {
      view.yaw += 0.003;
      draw();
    }
    raf = requestAnimationFrame(tick);
  }
  function startLoop() {
    if (!raf && view.auto) raf = requestAnimationFrame(tick);
  }
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) startLoop();
  });
  syncRot();
  document.getElementById('w3d-rotate').textContent = view.auto ? L.rotate : L.rotateOn;
  for (const [id, key] of [['w3d-reset', 'reset'], ['w3d-zoom-in', 'zoomIn'], ['w3d-zoom-out', 'zoomOut']]) document.getElementById(id).textContent = L[key];
  for (const [id, key] of [['w3d-x-label', 'x'], ['w3d-y-label', 'y'], ['w3d-z-label', 'z']]) document.getElementById(id).textContent = L[key];

  const usable = data.indicators.filter((x) => x.status === 'ok' && x.count > 0);
  if (usable.length >= 3) setIndicators(data.indicators);
  else {
    setIndicators([]);
    if (data.mode !== 'live') {
      note.textContent = L.notFetched;
      const b = el('button', null, L.sample);
      b.type = 'button';
      b.addEventListener('click', () => {
        setIndicators(sampleData(countries));
        b.remove();
      });
      document.getElementById('w3d-controls').append(b);
    }
  }
  startLoop();
}

async function main() {
  const note = document.getElementById('w3d-note');
  try {
    const [data, countries] = await Promise.all([
      fetch('data/compare.json', { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : Promise.reject(new Error('load')))),
      fetch('data/geo/country-index.json', { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : Promise.reject(new Error('load')))),
    ]);
    if (!Array.isArray(data?.indicators) || !Array.isArray(countries)) throw new Error('shape');
    start(data, countries);
  } catch {
    note.textContent = L.loadFail;
  }
}

if (typeof document !== 'undefined' && document.getElementById('w3d-canvas')) main();
