// 国境データと国名索引を作る、手動で一度だけ実行するスクリプト。
// 入力: Natural Earth（パブリックドメイン）の GeoJSON ファイル3つ（ローカルに置いたもの）
//   1. ne_10m_admin_0_countries_jpn.geojson … 「日本から見た国境（Point of View: Japan）」版。描画の形に使う
//      （日本の一般的な地図と同じく、クリミアはウクライナ、北方領土は日本として描かれる。
//        ソマリランドはソマリア、北キプロスはキプロスに含まれる）
//   2. ne_110m_admin_0_countries.geojson … 地球儀に描く国・地域の範囲（3 と合わせて使う）
//   3. ne_50m_admin_0_countries.geojson  … 検索用の国名索引（日本語名・英語名・表示位置）
// 出力: site/data/geo/countries-110m.json（描画用）, site/data/geo/country-index.json（国名・位置の索引）
// 使い方: node scripts/prepare-geo.mjs <10m_jpn.geojson> <110m.geojson> <50m.geojson>
// このスクリプトはネットワークに接続しない。外部ライブラリも使わない。
// 形の簡略化は、隣り合う国の境界線が同じ線になるように（すき間・重なりができないように）行う。

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [pathPov, path110, path50] = process.argv.slice(2);
if (!pathPov || !path110 || !path50) {
  console.error('usage: node scripts/prepare-geo.mjs <10m_jpn.geojson> <110m.geojson> <50m.geojson>');
  process.exit(1);
}
const EPS = 0.15; // 簡略化の許容誤差（度）
const MIN_AREA = 0.005; // これより小さい島（平方度）は描かない（ただし国境を持つ部分と、その国の最大の部分は残す）

const round = (n) => Math.round(n * 100) / 100;
const iso3 = (p) => (p.ISO_A3 && p.ISO_A3 !== '-99' ? p.ISO_A3 : p.ADM0_A3);
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
const polysOf = (g) => (g.type === 'Polygon' ? [g.coordinates] : g.coordinates);
const key = (pt) => `${pt[0]},${pt[1]}`;

const pov = read(pathPov);
// 描く国・地域：110m と 50m に載っているもの（小さな国も描く。描かないと、現在地の判定で隣の大きな国になってしまうため）
const drawIds = new Set([...read(path110).features, ...read(path50).features].map((f) => iso3(f.properties)));
const povIds = new Set(pov.features.map((f) => iso3(f.properties)));
const features = pov.features.filter((f) => drawIds.has(iso3(f.properties)));

// 1. どの輪（ring）にどの頂点が含まれるか
const rings = [];
for (const f of features) for (const poly of polysOf(f.geometry)) for (const ring of poly) rings.push(ring);
const owners = new Map();
rings.forEach((ring, r) => {
  for (const pt of ring) {
    const k = key(pt);
    const s = owners.get(k);
    if (!s) owners.set(k, [r]);
    else if (!s.includes(r)) s.push(r);
  }
});
const sig = (pt) => owners.get(key(pt)).join('|');

// 2. 区間ごとの簡略化（Douglas-Peucker）。同じ区間は向きによらず同じ結果にする
function dp(pts, eps = EPS) {
  if (pts.length <= 2) return pts;
  const [a, b] = [pts[0], pts[pts.length - 1]];
  let max = -1;
  let idx = 0;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i];
    const d = len === 0 ? Math.hypot(p[0] - a[0], p[1] - a[1]) : Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / len;
    if (d > max) {
      max = d;
      idx = i;
    }
  }
  if (max <= eps) return [a, b];
  const left = dp(pts.slice(0, idx + 1), eps);
  return left.slice(0, -1).concat(dp(pts.slice(idx), eps));
}
const cache = new Map();
function simplifySegment(seg, eps = EPS) {
  const fwd = seg.map(key).join(';');
  const rev = [...seg].reverse().map(key).join(';');
  const canonical = fwd <= rev ? seg : [...seg].reverse();
  const ck = fwd <= rev ? fwd : rev;
  const k2 = `${eps}|${ck}`;
  if (!cache.has(k2)) cache.set(k2, dp(canonical, eps));
  const out = cache.get(k2);
  return fwd <= rev ? out : [...out].reverse();
}
function simplifyRing(ring) {
  const pts = ring.slice(0, -1); // 閉じた輪の最後の点（=最初の点）を除く
  const n = pts.length;
  const fixed = [];
  for (let i = 0; i < n; i++) {
    const s = sig(pts[i]);
    if (s !== sig(pts[(i - 1 + n) % n]) || s !== sig(pts[(i + 1) % n])) fixed.push(i);
  }
  let eps = EPS;
  if (!fixed.length) {
    // 国境を持たない島：座標の最小の点から始めて、向きによらず同じ結果にする。
    // 小さな島が線や点につぶれないよう、島の大きさに応じて許容誤差を小さくする（隣の国と共有しないので、ずれは生じない）
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    eps = Math.min(EPS, Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) / 6);
    let m = 0;
    for (let i = 1; i < n; i++) if (key(pts[i]) < key(pts[m])) m = i;
    fixed.push(m);
  }
  const out = [];
  for (let j = 0; j < fixed.length; j++) {
    const s = fixed[j];
    const e = fixed[(j + 1) % fixed.length];
    const seg = [];
    for (let i = s; ; i = (i + 1) % n) {
      seg.push(pts[i]);
      if (i === e && seg.length > 1) break;
    }
    out.push(...simplifySegment(seg, eps).slice(0, -1));
  }
  const rounded = [];
  for (const p of out) {
    const q = [round(p[0]), round(p[1])];
    if (!rounded.length || key(rounded[rounded.length - 1]) !== key(q)) rounded.push(q);
  }
  if (rounded.length > 1 && key(rounded[0]) === key(rounded[rounded.length - 1])) rounded.pop();
  return { ring: [...rounded, rounded[0]], shared: fixed.length > 1 || owners.get(key(pts[fixed[0]])).length > 1 };
}
const signedArea = (ring) => {
  let a = 0;
  for (let i = 0; i < ring.length - 1; i++) a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  return a / 2;
};
const area = (ring) => Math.abs(signedArea(ring));
// 描画ライブラリ（d3-geo）の向きに合わせる：外周は時計回り、穴は反時計回り（逆向きだと地球全体を覆う形になる）
const orient = (ring, clockwise) => ((signedArea(ring) < 0) === clockwise ? ring : [...ring].reverse());

// 3. 国ごとに組み立てる
const shapes = { type: 'FeatureCollection', features: [] };
for (const f of features) {
  const polys = [];
  for (const poly of polysOf(f.geometry)) {
    const outer = simplifyRing(poly[0]);
    if (outer.ring.length < 4 || area(outer.ring) < 1e-4) continue;
    outer.ring = orient(outer.ring, true);
    const holes = poly.slice(1).map(simplifyRing).filter((h) => h.ring.length >= 4 && (h.shared || area(h.ring) >= MIN_AREA));
    polys.push({ coords: [outer.ring, ...holes.map((h) => orient(h.ring, false))], a: area(outer.ring), shared: outer.shared });
  }
  const biggest = Math.max(...polys.map((p) => p.a));
  const kept = polys.filter((p) => p.shared || p.a >= MIN_AREA || p.a === biggest).map((p) => p.coords);
  if (!kept.length) continue;
  shapes.features.push({
    type: 'Feature',
    id: iso3(f.properties),
    properties: {},
    geometry: kept.length === 1 ? { type: 'Polygon', coordinates: kept[0] } : { type: 'MultiPolygon', coordinates: kept },
  });
}

// 日本語の国名は、日本で一般に使われる短い呼び方にそろえる（正式名称の併記で、特定の立場をとっているように見えないように）
const JA_NAME = { TWN: '台湾', CHN: '中国', KOR: '韓国', PRK: '北朝鮮', KOS: 'コソボ', THA: 'タイ', MLI: 'マリ', MNG: 'モンゴル' };

// 索引用（50m）：小さな国も含めて、日本語名・英語名・表示位置を持つ（日本から見た国境版に無い地域は除く）
const g50 = read(path50);
const seen = new Set();
const index = [];
for (const f of g50.features) {
  const p = f.properties;
  const id = iso3(p);
  if (!id || seen.has(id) || !povIds.has(id)) continue;
  seen.add(id);
  const en = [...new Set([p.NAME, p.NAME_LONG, p.FORMAL_EN, p.NAME_EN, p.ADMIN, p.NAME_SORT].filter(Boolean))];
  index.push({ id, ja: JA_NAME[id] || p.NAME_JA || p.NAME, enName: p.NAME_LONG || p.NAME, en, lon: round(p.LABEL_X), lat: round(p.LABEL_Y) });
}
index.sort((a, b) => a.ja.localeCompare(b.ja, 'ja'));

const out = resolve(root, 'site/data/geo');
mkdirSync(out, { recursive: true });
writeFileSync(resolve(out, 'countries-110m.json'), JSON.stringify(shapes));
writeFileSync(resolve(out, 'country-index.json'), JSON.stringify(index));
console.log(`shapes: ${shapes.features.length}, index: ${index.length}`);
