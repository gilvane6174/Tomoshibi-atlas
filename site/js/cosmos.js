// 「宇宙へ」：地球儀から月・太陽系・銀河・宇宙全体へゆっくり引いていき、また地球へもどる演出。
// 画像は使わず、すべてこのファイルで描く。外部への通信はしない。文字は textContent だけで入れる。
// 光で発作が起きる人がいるため、点滅はしない（星のまたたきは2〜4秒かけて、ほのかに明るさが変わる程度）。
// 端末で「動きを減らす」設定をしている人には、引いていく動きを省き、最後の宇宙の画面と文字だけを静かに出す。
// 大きさや距離は実際とは違うイメージ（画面に注記を出す）。月の満ち欠けと惑星の並びは、今の時刻からおおよそを計算する。

const RAD = Math.PI / 180;
const DAY = 86400000;

// 月齢（日）：新月（2000-01-06 18:14 UTC）からの経過を、朔望月 29.530589 日で割った余り
export function moonAge(date = new Date()) {
  const days = (date.getTime() - Date.UTC(2000, 0, 6, 18, 14)) / DAY;
  return ((days % 29.530589) + 29.530589) % 29.530589;
}

// 惑星の平均黄経（度、おおよそ）：J2000 の値に、公転周期から進んだ角度を足す
// 惑星：軌道の大きさ a（天文単位）・平均の黄経・公転周期は実際の値。見た目の大きさは、実際の半径（km）を対数で縮めたもの
const PLANETS = [
  { id: 'mercury', a: 0.387, L0: 252.25, P: 87.969, km: 2440, c: '#aaa49b' },
  { id: 'venus', a: 0.723, L0: 181.98, P: 224.7, km: 6052, c: '#e6cf9e' },
  { id: 'earth', a: 1.0, L0: 100.46, P: 365.256, km: 6371, c: '#4f86c6' },
  { id: 'mars', a: 1.524, L0: 355.45, P: 686.98, km: 3390, c: '#c8643c' },
  { id: 'jupiter', a: 5.203, L0: 34.4, P: 4332.59, km: 69911, c: '#d8b48a', bands: true },
  { id: 'saturn', a: 9.537, L0: 49.94, P: 10759.22, km: 58232, c: '#e3cf98', ring: true, bands: true },
  { id: 'uranus', a: 19.19, L0: 313.23, P: 30688.5, km: 25362, c: '#9fd6dc' },
  { id: 'neptune', a: 30.07, L0: 304.88, P: 60182, km: 24622, c: '#4f74d8' },
].map((p) => ({ ...p, r: 1.2 + 1.55 * Math.log(p.km / 2440) }));
// 天の川銀河の中での太陽系の位置：中心から半径のおよそ半分（約2万6千光年）、腕と腕のあいだ（オリオン腕）
// 宇宙の場面の月は満月で描く
const FULL_MOON = 29.530589 / 2;
const SUN_IN_GALAXY = { rad: 0.52, ang: 2.15 };
export function planetLongitudes(date = new Date()) {
  const d = (date.getTime() - Date.UTC(2000, 0, 1, 12)) / DAY;
  return Object.fromEntries(PLANETS.map((p) => [p.id, (((p.L0 + (360 / p.P) * d) % 360) + 360) % 360]));
}

const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const smooth = (x) => {
  const k = clamp(x);
  return k * k * (3 - 2 * k);
};
// 正弦のなだらかな出入り（速さの山が低く、急に速くならない）
const ease = (x) => (1 - Math.cos(Math.PI * clamp(x))) / 2;
// p の区間 [a, b] での出入り（a で 0、b で 1）
const band = (p, a, b) => smooth((p - a) / (b - a));

// 決まった乱数（毎回同じ星の並びにする）
function rng(seed) {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

// 正規分布に近い乱数（星の集まりのばらつきに使う）
function gauss(r) {
  return (r() + r() + r() + r() - 2) / 2;
}

// 遠くの銀河の小さな絵を1回だけ描いておく（毎フレームは、この絵を回して置くだけなので軽い）
// 線に見えないよう、ぼんやりしたもやと、散らばった細かな星だけで描く
// type: spiral（渦）／loose（ゆるい渦）／elliptical（楕円銀河）
function makeGalaxyImage(size, type, seed, count) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const r = rng(seed);
  const C = size / 2;
  const blob = (x, y, rad, col) => {
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, col);
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  };
  g.globalCompositeOperation = 'lighter';
  // ぼんやりした光のかたまり（腕の線は描かない）
  blob(C, C, size * 0.46, 'rgba(160,180,235,0.10)');
  blob(C, C, size * (type === 'elliptical' ? 0.3 : 0.2), 'rgba(255,230,200,0.8)');
  blob(C, C, size * 0.07, 'rgba(255,244,226,0.8)');
  // 小さな星のかたまりを、いくつか散らす
  const clumps = Array.from({ length: type === 'elliptical' ? 2 : 5 }, () => {
    const d = (0.1 + r() * 0.26) * size;
    const a = r() * Math.PI * 2;
    return [C + Math.cos(a) * d, C + Math.sin(a) * d, (0.04 + r() * 0.06) * size];
  });
  for (const [x, y, rad] of clumps) blob(x, y, rad * 2.6, r() < 0.5 ? 'rgba(170,195,255,0.12)' : 'rgba(255,215,190,0.1)');
  for (let i = 0; i < count; i++) {
    let x;
    let y;
    if (r() < 0.45 && clumps.length) {
      const [cx, cy, rad] = clumps[Math.floor(r() * clumps.length)];
      x = cx + gauss(r) * rad;
      y = cy + gauss(r) * rad;
    } else {
      // 中心ほど多い、ぼやけた円盤。外ほど少しねじって、回っている感じだけを残す
      const d = Math.abs(gauss(r)) * size * 0.17;
      const a = r() * Math.PI * 2 + (d / size) * 2.2;
      x = C + Math.cos(a) * d;
      y = C + Math.sin(a) * d;
    }
    const t = Math.min(1, Math.hypot(x - C, y - C) / (size * 0.45));
    g.fillStyle = `rgba(${Math.round(255 - 50 * t)},${Math.round(236 - 8 * t)},${Math.round(214 + 40 * t)},${((0.06 + r() * 0.14) * (1 - t * 0.5)).toFixed(3)})`;
    g.fillRect(x, y, 1.2, 1.2);
  }
  return c;
}

// 天の川銀河（主役）の星：1つ1つを毎フレーム回して描く（内側ほど少し速く回る）
// 腕はゆるく、星は広く散らす。固めすぎず、ぼうっと散らかった星の集まりに見えるように
function makeGalaxyStars(n, seed) {
  // 天の川銀河は「棒渦巻き銀河」：中心に棒のような星の集まり、そこから大きな腕2本と小さな腕2本がのびる
  // 腕は回る向きと逆に巻く（後ろへたなびく形）。巻き具合は約12度
  const r = rng(seed);
  const wind = Math.tan((12 * Math.PI) / 180);
  const r0 = 0.16;
  const maxTheta = Math.log(1 / r0) / wind;
  const ARMS = [
    { off: 0, w: 0.3 },
    { off: Math.PI, w: 0.3 },
    { off: Math.PI / 2, w: 0.2 },
    { off: (3 * Math.PI) / 2, w: 0.2 },
  ];
  const pickArm = () => {
    let u = r();
    for (const a of ARMS) if ((u -= a.w) <= 0) return a;
    return ARMS[0];
  };
  const out = [];
  for (let i = 0; i < n; i++) {
    const u = r();
    let rad;
    let ang;
    let col;
    if (u < 0.1) {
      // 中心のふくらみ（古い星が多く、暖かい色）
      rad = Math.abs(gauss(r)) * 0.1;
      ang = r() * Math.PI * 2;
      col = '255,222,186';
    } else if (u < 0.2) {
      // 棒：細長い星の集まり
      const along = gauss(r) * 0.2;
      const across = gauss(r) * 0.045;
      const bar = 0.45;
      const x = along * Math.cos(bar) - across * Math.sin(bar);
      const y = along * Math.sin(bar) + across * Math.cos(bar);
      rad = Math.hypot(x, y);
      ang = Math.atan2(y, x);
      col = '255,228,196';
    } else if (u < 0.5) {
      // 円盤（腕のあいだも、うっすら星がある）
      rad = Math.min(1.05, -Math.log(1 - r() * 0.97) * 0.26);
      ang = r() * Math.PI * 2;
      col = rad < 0.3 ? '255,226,196' : r() < 0.5 ? '214,226,255' : '236,232,246';
    } else if (u < 0.93) {
      // 腕：若い青白い星が多く、ところどころ桃色の光（星が生まれている場所）
      const arm = pickArm();
      const th = Math.pow(r(), 0.9) * maxTheta;
      const base = r0 * Math.exp(wind * th);
      rad = Math.max(0.05, Math.min(1.08, base + gauss(r) * (0.04 + 0.1 * base)));
      ang = -th + arm.off + 0.45 + gauss(r) * 0.3;
      const c = r();
      col = c < 0.08 ? '255,170,205' : c < 0.2 ? '200,180,255' : c < 0.6 ? '190,212,255' : '232,238,255';
    } else {
      // 銀河のまわりにまばらに散る星（ハロー）
      rad = 0.9 + r() * 0.7;
      ang = r() * Math.PI * 2;
      col = r() < 0.5 ? '255,236,214' : '214,226,255';
    }
    const sparkle = r() < 0.012;
    out.push({ rad, ang, s: sparkle ? 1.1 + r() * 0.6 : 0.45 + r() * 0.55, a: sparkle ? 0.55 + r() * 0.3 : 0.12 + r() * 0.4, c: col, sparkle, ph: r() * Math.PI * 2, per: 3 + r() * 3 });
  }
  return out;
}

// 天の川銀河の、暗い塵の帯（腕の内側にそって、光をさえぎる）
function makeGalaxyDust(size, seed) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const r = rng(seed);
  const C = size / 2;
  const wind = Math.tan((12 * Math.PI) / 180);
  const r0 = 0.16;
  const maxTheta = Math.log(1 / r0) / wind;
  for (let i = 0; i < 260; i++) {
    const off = i % 2 ? Math.PI : 0;
    const th = Math.pow(r(), 0.9) * maxTheta * 0.85;
    const base = r0 * Math.exp(wind * th) * 0.94; // 腕の少し内側
    const ang = -th + off + 0.45 + gauss(r) * 0.12;
    const d = base * size * 0.5;
    const x = C + Math.cos(ang) * d;
    const y = C + Math.sin(ang) * d;
    const rad = size * (0.012 + r() * 0.02);
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, 'rgba(18,10,8,0.22)');
    gr.addColorStop(1, 'rgba(18,10,8,0)');
    g.fillStyle = gr;
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  return c;
}

// 太陽の表面（細かなつぶつぶの模様と、ふちの暗さ）。動かさない（ちかちかさせない）
function makeSunImage(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const R = size / 2 - 1;
  const C = size / 2;
  const r = rng(29);
  const blob = (x, y, rad, col) => {
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, col);
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  };
  g.save();
  g.beginPath();
  g.arc(C, C, R, 0, Math.PI * 2);
  g.clip();
  // 中心は白に近く、ふちへ向かって黄色からだいだいへ暗くなる（周辺減光）
  const base = g.createRadialGradient(C, C, 0, C, C, R);
  base.addColorStop(0, '#fffbea');
  base.addColorStop(0.45, '#ffeab0');
  base.addColorStop(0.75, '#ffc96a');
  base.addColorStop(0.93, '#f7a948');
  base.addColorStop(1, '#ec8a3c');
  g.fillStyle = base;
  g.fillRect(0, 0, size, size);
  // 粒状斑：細かな明るい粒と、そのすき間の暗い網目
  for (let i = 0; i < size * 14; i++) {
    const d = Math.sqrt(r()) * R;
    const a = r() * Math.PI * 2;
    const rad = size * (0.004 + r() * 0.007);
    blob(C + Math.cos(a) * d, C + Math.sin(a) * d, rad, r() < 0.55 ? 'rgba(255,252,225,0.13)' : 'rgba(190,90,25,0.1)');
  }
  // 大きめのむら
  for (let i = 0; i < 70; i++) {
    const d = Math.sqrt(r()) * R;
    const a = r() * Math.PI * 2;
    blob(C + Math.cos(a) * d, C + Math.sin(a) * d, size * (0.04 + r() * 0.06), r() < 0.5 ? 'rgba(255,240,200,0.08)' : 'rgba(210,110,40,0.07)');
  }
  // 白斑（ふちの近くに出る、明るいすじ）
  for (let i = 0; i < 40; i++) {
    const a = r() * Math.PI * 2;
    const d = R * (0.78 + r() * 0.18);
    blob(C + Math.cos(a) * d, C + Math.sin(a) * d, size * (0.012 + r() * 0.02), 'rgba(255,245,215,0.2)');
  }
  // 黒点：赤道をはさんだ南北の中緯度に、いくつかのかたまり（群）で出る。
  // 中心の暗い部分（暗部）のまわりに、少し明るいふち（半暗部）。ふちに近いほど横につぶれて見える
  const spot = (x, y, rad) => {
    const t = Math.min(0.95, Math.hypot(x - C, y - C) / R);
    g.save();
    g.translate(x, y);
    g.rotate(Math.atan2(y - C, x - C));
    g.scale(Math.sqrt(1 - t * t), 1);
    for (let k = 0; k < 5; k++) blob((r() - 0.5) * rad * 0.8, (r() - 0.5) * rad * 0.8, rad * (1.1 + r() * 0.5), 'rgba(150,72,22,0.32)');
    blob(0, 0, rad * 0.55, 'rgba(55,22,8,0.85)');
    blob(rad * 0.1, -rad * 0.05, rad * 0.3, 'rgba(30,10,4,0.6)');
    g.restore();
  };
  for (const [gx, gy, n] of [
    [-0.3, -0.24, 5],
    [0.28, 0.2, 4],
    [0.05, -0.32, 2],
    [-0.1, 0.28, 3],
  ]) {
    for (let k = 0; k < n; k++) spot(C + (gx + (r() - 0.5) * 0.16) * R, C + (gy + (r() - 0.5) * 0.06) * R, R * (0.012 + Math.pow(r(), 2) * 0.03));
  }
  // ふちの暗さをもう一段（球に見えるように）
  const limb = g.createRadialGradient(C, C, R * 0.6, C, C, R);
  limb.addColorStop(0, 'rgba(120,40,0,0)');
  limb.addColorStop(0.85, 'rgba(120,40,0,0.06)');
  limb.addColorStop(1, 'rgba(140,50,0,0.16)');
  g.fillStyle = limb;
  g.fillRect(0, 0, size, size);
  g.restore();
  return c;
}

// 天の川銀河のもや（線を出さず、ぼんやりした光の雲だけ）
function makeGalaxyHaze(size, seed) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const r = rng(seed);
  const C = size / 2;
  g.globalCompositeOperation = 'lighter';
  const blob = (x, y, rad, col) => {
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, col);
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  };
  blob(C, C, size * 0.5, 'rgba(150,160,230,0.10)');
  blob(C + size * 0.12, C - size * 0.05, size * 0.3, 'rgba(190,150,230,0.05)');
  blob(C - size * 0.15, C + size * 0.08, size * 0.28, 'rgba(120,190,240,0.05)');
  blob(C, C, size * 0.2, 'rgba(255,222,180,0.42)');
  blob(C, C, size * 0.07, 'rgba(255,240,215,0.45)');
  const wind = Math.tan((12 * Math.PI) / 180);
  const maxTheta = Math.log(1 / 0.16) / wind;
  for (let i = 0; i < 240; i++) {
    const th = Math.pow(r(), 0.9) * maxTheta;
    const base = 0.16 * Math.exp(wind * th);
    const ang = -th + (i % 4) * (Math.PI / 2) + 0.45 + gauss(r) * 0.3;
    const d = (base + gauss(r) * 0.08) * size * 0.48;
    const tint = r() < 0.15 ? 'rgba(235,150,210,0.07)' : base > 0.45 ? 'rgba(150,180,255,0.085)' : 'rgba(255,215,180,0.08)';
    blob(C + Math.cos(ang) * d, C + Math.sin(ang) * d, size * (0.05 + r() * 0.07), tint);
  }
  return c;
}

// 月：月齢の満ち欠けで描く（太陽の向きが明るい）。欠けた側もうっすら見える（地球照）。地球儀の画面でも使う
// 月の絵（模様・クレーター・影）を1回だけ作る。太陽は右（+x）側にある向きで描き、使うときに回す
// なめらかな乱数の模様（値ノイズを何段か重ねる）。月の海の形や、表面のむらに使う
function makeNoise(seed) {
  const r = rng(seed);
  const N = 256;
  const perm = new Uint8Array(N * 2);
  const val = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    perm[i] = i;
    val[i] = r();
  }
  for (let i = N - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [perm[i], perm[j]] = [perm[j], perm[i]];
  }
  for (let i = 0; i < N; i++) perm[N + i] = perm[i];
  const sm = (t) => t * t * (3 - 2 * t);
  const n2 = (x, y) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = sm(x - xi);
    const yf = sm(y - yi);
    const X = xi & 255;
    const Y = yi & 255;
    const v00 = val[perm[X + perm[Y]]];
    const v10 = val[perm[X + 1 + perm[Y]]];
    const v01 = val[perm[X + perm[Y + 1]]];
    const v11 = val[perm[X + 1 + perm[Y + 1]]];
    return v00 + (v10 - v00) * xf + (v01 - v00) * yf + (v00 - v10 - v01 + v11) * xf * yf;
  };
  return (x, y, oct = 5) => {
    let s = 0;
    let a = 0.5;
    let f = 1;
    for (let i = 0; i < oct; i++) {
      s += n2(x * f, y * f) * a;
      f *= 2.03;
      a *= 0.5;
    }
    return s / (1 - Math.pow(0.5, oct));
  };
}

// 月の表側の、主な「海」（暗い平原）のおおよその場所と大きさ（円盤の中心が0、半径が1）
// 雨の海・晴れの海・静かの海・危難の海・豊かの海・神酒の海・嵐の大洋・雲の海・湿りの海・氷の海など
const MARIA = [
  [-0.28, -0.4, 0.25, 0.22],
  [0.2, -0.36, 0.15, 0.14],
  [0.36, -0.06, 0.2, 0.17],
  [0.7, -0.28, 0.1, 0.12],
  [0.58, 0.14, 0.13, 0.15],
  [0.38, 0.27, 0.08, 0.08],
  [-0.62, -0.02, 0.24, 0.42],
  [-0.48, -0.38, 0.14, 0.2],
  [-0.15, 0.3, 0.15, 0.13],
  [-0.48, 0.37, 0.09, 0.09],
  [-0.05, -0.68, 0.42, 0.07],
  [0.0, -0.12, 0.12, 0.09],
];

// 月の表面の絵。満月（真正面から光が当たる）を前提に、海の濃淡・明るい高地・クレーターと光条を描く
function makeMoonImage(size, age) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const R = size / 2 - 2;
  const C = size / 2;
  const r = rng(7);
  const noise = makeNoise(77);
  const phase = (age / 29.530589) * Math.PI * 2;
  // 1. 濃淡の地図（海と高地）：細かさはほどほど（最大512）で作り、なめらかに引き伸ばす
  const M = Math.min(512, size);
  const base = document.createElement('canvas');
  base.width = base.height = M;
  const bg = base.getContext('2d');
  const im = bg.createImageData(M, M);
  const mR = M / 2 - 1;
  for (let j = 0; j < M; j++) {
    for (let i = 0; i < M; i++) {
      const x = (i - M / 2) / mR;
      const y = (j - M / 2) / mR;
      const d2 = x * x + y * y;
      const o = (j * M + i) * 4;
      if (d2 > 1.02) continue;
      // 球の上での位置（ふちに近いほど、模様が詰まって見える）
      const z = Math.sqrt(Math.max(0, 1 - d2));
      const ux = x / (0.6 + 0.4 * z);
      const uy = y / (0.6 + 0.4 * z);
      // 海：場所そのものをノイズでゆがめて（楕円に見えないように）、ふちはなだらかに
      const wx = ux + (noise(ux * 2.2 + 3, uy * 2.2 + 9, 4) - 0.5) * 0.42 + (noise(ux * 7 + 1, uy * 7, 3) - 0.5) * 0.12;
      const wy = uy + (noise(ux * 2.2 + 17, uy * 2.2 + 2, 4) - 0.5) * 0.42 + (noise(ux * 7, uy * 7 + 4, 3) - 0.5) * 0.12;
      let mar = 0;
      for (const [mx, my, rx, ry] of MARIA) {
        const dx = (wx - mx) / rx;
        const dy = (wy - my) / ry;
        mar += Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy));
      }
      mar += (noise(ux * 4 + 30, uy * 4 + 30, 4) - 0.55) * 0.5;
      mar = Math.min(1, Math.max(0, (mar + 0.06) / 0.75));
      mar = Math.pow(mar, 0.8);
      const n1 = noise(ux * 6 + 1, uy * 6 + 2, 5);
      const n2 = noise(ux * 22 + 7, uy * 22 + 3, 4);
      // 高地は明るい灰色、海は少し青みのある暗い灰色。海の中にも濃淡
      const hi = 205 + (n1 - 0.5) * 34 + (n2 - 0.5) * 22;
      const lo = 150 + (n1 - 0.5) * 46 + (n2 - 0.5) * 26;
      let v = hi + (lo - hi) * mar * (0.55 + 0.6 * noise(ux * 9 + 40, uy * 9 + 40, 3));
      // 満月は、ふちまでほぼ同じ明るさ（ほんの少しだけ暗く）
      v *= 0.9 + 0.1 * Math.pow(z, 0.4);
      im.data[o] = v * (1.0 - 0.02 * mar);
      im.data[o + 1] = v * 0.985;
      im.data[o + 2] = v * (0.95 + 0.03 * mar);
      im.data[o + 3] = 255;
    }
  }
  bg.putImageData(im, 0, 0);
  g.save();
  g.beginPath();
  g.arc(C, C, R, 0, Math.PI * 2);
  g.clip();
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(base, C - R - 1, C - R - 1, (R + 1) * 2, (R + 1) * 2);
  // 2. 細かなざらつき（小さな模様を敷き詰める。大きな月でも、のっぺりしない）
  const T = 256;
  const tile = document.createElement('canvas');
  tile.width = tile.height = T;
  const tg = tile.getContext('2d');
  const tim = tg.createImageData(T, T);
  for (let i = 0; i < T * T; i++) {
    const v = r();
    const o = i * 4;
    tim.data[o] = tim.data[o + 1] = tim.data[o + 2] = v > 0.5 ? 255 : 30;
    tim.data[o + 3] = Math.round(Math.pow(Math.abs(v - 0.5) * 2, 2) * 26);
  }
  tg.putImageData(tim, 0, 0);
  g.save();
  g.globalAlpha = 0.7;
  const pat = g.createPattern(tile, 'repeat');
  const ts = Math.max(1, size / 1024);
  g.scale(ts, ts);
  g.fillStyle = pat;
  g.fillRect(0, 0, size / ts, size / ts);
  g.restore();
  // 3. クレーター：小さいものほど多い。満月の光なので深い影は付けず、明るいふちと、わずかに暗い底
  const blob = (x, y, rad, col) => {
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, col);
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  };
  const crater = (x, y, cr, t, bright) => {
    g.save();
    g.translate(x, y);
    // ふちに近いほど、円が横につぶれて見える（中心へ向かう向きにつぶす）
    g.rotate(Math.atan2(y - C, x - C));
    g.scale(Math.max(0.3, Math.sqrt(1 - t * t)), 1);
    const rg = g.createRadialGradient(0, 0, cr * 0.55, 0, 0, cr * 1.15);
    rg.addColorStop(0, 'rgba(60,58,56,0.10)');
    rg.addColorStop(0.62, 'rgba(60,58,56,0.06)');
    rg.addColorStop(0.8, `rgba(255,253,245,${bright ? 0.32 : 0.14})`);
    rg.addColorStop(1, 'rgba(255,253,245,0)');
    g.fillStyle = rg;
    g.beginPath();
    g.arc(0, 0, cr * 1.15, 0, Math.PI * 2);
    g.fill();
    if (cr > R * 0.025) blob(0, 0, cr * 0.18, 'rgba(255,252,240,0.18)'); // 中央の山
    g.restore();
  };
  const place = () => {
    const d = Math.sqrt(r()) * R * 0.98;
    const a = r() * Math.PI * 2;
    return [C + Math.cos(a) * d, C + Math.sin(a) * d, d / R];
  };
  const count = Math.round(1400 * (size / 1024));
  for (let i = 0; i < count; i++) {
    const [x, y, t] = place();
    crater(x, y, R * (0.0025 + Math.pow(r(), 3.2) * 0.012), t, false);
  }
  for (let i = 0; i < 90; i++) {
    const [x, y, t] = place();
    crater(x, y, R * (0.013 + Math.pow(r(), 2) * 0.026), t, r() < 0.15);
  }
  // 4. 光条（明るいクレーターから放射状にのびる、白い筋）：ティコ・コペルニクス・ケプラーなど
  for (const [bx, by, n, L] of [
    [-0.13, 0.7, 60, 0.95],
    [-0.3, -0.12, 40, 0.45],
    [-0.55, -0.1, 28, 0.3],
    [0.62, -0.55, 16, 0.22],
    [0.2, 0.58, 16, 0.22],
  ]) {
    const x = C + bx * R;
    const y = C + by * R;
    g.save();
    for (let k = 0; k < n; k++) {
      const ang = r() * Math.PI * 2;
      const len = R * L * (0.25 + r() * 0.75);
      const wd = R * (0.006 + r() * 0.02);
      const st = R * (0.02 + r() * 0.05); // 光条は、クレーターのすぐ外から始まる
      g.save();
      g.translate(x, y);
      g.rotate(ang);
      const lg = g.createLinearGradient(st, 0, len, 0);
      lg.addColorStop(0, 'rgba(250,250,244,0)');
      lg.addColorStop(0.15, 'rgba(250,250,244,0.05)');
      lg.addColorStop(1, 'rgba(250,250,244,0)');
      g.fillStyle = lg;
      g.beginPath();
      g.moveTo(st, -wd * 0.4);
      g.quadraticCurveTo((st + len) / 2, -wd, len, 0);
      g.quadraticCurveTo((st + len) / 2, wd, st, wd * 0.4);
      g.closePath();
      g.fill();
      g.restore();
    }
    blob(x, y, R * 0.045, 'rgba(250,250,244,0.12)');
    g.restore();
    crater(x, y, R * 0.016, Math.hypot(bx, by), true);
  }
  // 5. 満月以外のときの影（今は満月で描くので、ふつうは使わない）
  if (Math.abs(phase - Math.PI) > 0.15) {
    const sh = document.createElement('canvas');
    sh.width = sh.height = size;
    const s2 = sh.getContext('2d');
    s2.fillStyle = 'rgba(6,9,16,0.74)';
    s2.beginPath();
    s2.arc(C, C, R + 2, 0, Math.PI * 2);
    s2.fill();
    const k = Math.cos(phase);
    s2.globalCompositeOperation = 'destination-out';
    s2.beginPath();
    for (let i = 0; i <= 48; i++) {
      const tt = -Math.PI / 2 + (Math.PI * i) / 48;
      const px = C + Math.cos(tt) * (R + 3);
      const py = C + Math.sin(tt) * (R + 3);
      i ? s2.lineTo(px, py) : s2.moveTo(px, py);
    }
    for (let i = 48; i >= 0; i--) {
      const tt = -Math.PI / 2 + (Math.PI * i) / 48;
      s2.lineTo(C + Math.cos(tt) * R * k, C + Math.sin(tt) * (R + 3));
    }
    s2.closePath();
    s2.fill();
    g.drawImage(sh, 0, 0);
  }
  g.restore();
  return c;
}

const moonCache = new Map();
// 月：今の月齢の満ち欠けで描く（sunAng は太陽の向き）
export function drawMoonShape(ctx, x, y, rad, sunAng, age, alpha) {
  // 大きく見せるときは、細かい絵（1024）を使う
  // 画面いっぱいの月（はじめの場面）は、さらに細かい絵（2048）
  const tier = rad > 600 ? 2 : rad > 160 ? 1 : 0;
  const key = `${Math.round(age * 4)}-${tier}`;
  if (!moonCache.has(key)) moonCache.set(key, makeMoonImage([512, 1024, 2048][tier], age));
  const img = moonCache.get(key);
  const phase = (age / 29.530589) * Math.PI * 2;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  // 満月は、模様の向きをいつも同じにする（回さない）
  if (Math.abs(phase - Math.PI) > 0.15) ctx.rotate(sunAng);
  // ほのかな光の輪（満月に近いほど少し明るい）
  const glow = ctx.createRadialGradient(0, 0, rad * 0.95, 0, 0, rad * 1.9);
  glow.addColorStop(0, `rgba(235,230,215,${((0.08 * (1 - Math.cos(phase))) / 2 + 0.02).toFixed(3)})`);
  glow.addColorStop(1, 'rgba(235,230,215,0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(0, 0, rad * 1.9, 0, Math.PI * 2);
  ctx.fill();
  ctx.drawImage(img, -rad, -rad, rad * 2, rad * 2);
  ctx.restore();
}

export class Cosmos {
  // globe：地球儀（globe.js の Globe）。canvas：背景の星・月・太陽・銀河を描く。ui：ボタン・文字の要素
  constructor(globe, canvas, ui) {
    this.globe = globe;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    // 月は地球より手前にあるので、地球儀の上に重ねる別の絵に描く（地球の後ろへ回りこんで見えないように）
    this.front = document.getElementById('cosmos-front');
    this.fctx = this.front ? this.front.getContext('2d') : null;
    this.ui = ui;
    this.reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.small = Math.min(window.innerWidth, window.innerHeight) < 600 || (navigator.hardwareConcurrency || 4) <= 2;
    const r = rng(20261120);
    this.stars = Array.from({ length: this.small ? 300 : 520 }, () => ({ x: r(), y: r(), b: 0.25 + r() * 0.75, s: r() < 0.06 ? 1.5 : 0.4 + r() * 0.8, ph: r() * Math.PI * 2, per: 2 + r() * 2 }));
    // 遠くの銀河：1つずつ回る速さと向きを変え、宇宙全体がゆっくり動いているように
    this.far = Array.from({ length: this.small ? 46 : 84 }, () => ({
      x: r() * 1.3 - 0.15,
      y: r() * 1.3 - 0.15,
      s: 8 + Math.pow(r(), 2) * 32,
      rot: r() * Math.PI * 2,
      spin: (r() < 0.5 ? -1 : 1) * (0.008 + r() * 0.05),
      tilt: 0.35 + r() * 0.65,
      k: Math.floor(r() * 4),
      a: 0.45 + r() * 0.5,
      ph: r() * Math.PI * 2,
    }));
    // 天の川銀河の星や銀河の絵は重いので、初めて「宇宙へ」を押したときに作る（#ensure）
    this.ready = false;
    this.p = 0; // 0＝地球、4＝宇宙全体
    this.dir = 0; // 1＝宇宙へ、-1＝地球へもどる、0＝止まっている
    this.active = false;
    this.textShown = false;
    this.planetsAt = planetLongitudes();
    this.resize();
    const onResize = () => {
      this.resize();
      if (this.textShown) this.textRect = this.#textBox();
      if (this.reduce && this.active) this.#draw();
    };
    window.addEventListener('resize', onResize);
    // 画面の向きを変えたあと、大きさが確定してからもう一度合わせる（iPhone などで、つぶれた絵のまま残らないように）
    let pending = 0;
    const later = () => {
      if (pending) return;
      pending = requestAnimationFrame(() => {
        pending = 0;
        const w = this.canvas.clientWidth || window.innerWidth;
        const h = this.canvas.clientHeight || window.innerHeight;
        if (w !== this.w || h !== this.h) onResize();
      });
    };
    window.addEventListener('orientationchange', later);
    if ('ResizeObserver' in window) new ResizeObserver(later).observe(this.canvas);
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = this.canvas.clientWidth || window.innerWidth;
    this.h = this.canvas.clientHeight || window.innerHeight;
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (this.front) {
      this.front.width = this.canvas.width;
      this.front.height = this.canvas.height;
      this.fctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    if (this.ready) this.sky = this.#makeSky();
  }

  // 重い絵を1回だけ作る
  #ensure() {
    if (this.ready) return;
    this.ready = true;
    this.gstars = makeGalaxyStars(this.small ? 7000 : 15000, 11);
    // 銀河になる前の動き：画面に散らばった星が、小さくなった太陽系のまわりへ群がって星の塊になり、
    // その塊がほどけて渦巻きの形になる。そのための、星ごとの「散らばる場所」「塊の中の場所」「遅れ」
    const r2 = rng(5);
    for (const st of this.gstars) {
      st.sa = r2() * Math.PI * 2;
      st.sd = 0.2 + Math.pow(r2(), 0.7) * 1.0;
      const cr = Math.abs(gauss(r2)) * (0.35 + st.rad * 0.65);
      const ca = r2() * Math.PI * 2;
      st.cx = Math.cos(ca) * cr;
      st.cy = Math.sin(ca) * cr * 0.75;
      st.dl = r2() * 0.22 + Math.min(0.18, st.rad * 0.12);
    }
    this.haze = makeGalaxyHaze(this.small ? 360 : 512, 13);
    this.dust = makeGalaxyDust(this.small ? 360 : 512, 17);
    this.sunImg = makeSunImage(512);
    const r3 = rng(41);
    // コロナのすじとプロミネンスのかたまり（数と形は固定。動きは時間で決まる）
    this.corona = Array.from({ length: 10 }, () => ({ a: r3() * Math.PI * 2, len: 0.5 + r3() * 1.4, wd: 0.12 + r3() * 0.2, sp: 0.15 + r3() * 0.2, ph: r3() * Math.PI * 2 }));
    this.flares = Array.from({ length: 7 }, () => {
      const n = 6 + Math.floor(r3() * 8);
      const puffs = Array.from({ length: n }, (_, k) => {
        const t = k / (n - 1);
        // 根もとは低く太く、先へ行くほど高く細く、少し横に流れる
        return { h: 0.02 + t * (0.06 + r3() * 0.12), da: (t - 0.5) * (0.05 + r3() * 0.08), r: 0.035 + (1 - t) * 0.04 + r3() * 0.02, a: 0.5 + r3() * 0.5, ph: r3() * Math.PI * 2 };
      });
      return { a: r3() * Math.PI * 2, sp: 0.4 + r3() * 0.5, ph: r3() * Math.PI * 2, puffs };
    });
    this.sprites = [makeGalaxyImage(128, 'spiral', 21, 2200), makeGalaxyImage(128, 'loose', 33, 2200), makeGalaxyImage(128, 'elliptical', 45, 1500), makeGalaxyImage(128, 'spiral', 57, 2200)];
    this.sky = this.#makeSky();
  }

  // 背景の空：星の集まる帯（天の川）と、かすかな星雲のもや。1回だけ描いておき、ゆっくり回す
  #makeSky() {
    // 回しても隅が欠けない大きさ。大きな画面でもメモリを使いすぎないよう、一辺 2400 までにして、描くときに引きのばす
    const D = Math.min(2400, Math.ceil(Math.hypot(this.w, this.h)));
    const c = document.createElement('canvas');
    c.width = c.height = D;
    const g = c.getContext('2d');
    const r = rng(99);
    const C = D / 2;
    const ang = -0.45; // 帯の傾き
    const ux = Math.cos(ang);
    const uy = Math.sin(ang);
    // もや（帯に沿って、淡い青と暖かい色の雲）
    for (let i = 0; i < 160; i++) {
      const along = (r() - 0.5) * D;
      const across = gauss(r) * D * 0.05;
      const x = C + ux * along - uy * across;
      const y = C + uy * along + ux * across;
      const rad = D * (0.025 + r() * 0.05);
      const warm = r() < 0.35;
      const grd = g.createRadialGradient(x, y, 0, x, y, rad);
      grd.addColorStop(0, warm ? 'rgba(255,205,175,0.022)' : 'rgba(160,180,255,0.026)');
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd;
      g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    // 星（帯の近くほど多く、細かく）
    g.globalCompositeOperation = 'lighter';
    const n = this.small ? 8000 : 17000;
    for (let i = 0; i < n; i++) {
      const inBand = r() < 0.72;
      const along = (r() - 0.5) * D;
      const across = inBand ? gauss(r) * D * 0.07 : (r() - 0.5) * D;
      const x = C + ux * along - uy * across;
      const y = C + uy * along + ux * across;
      const a = inBand ? 0.08 + r() * 0.35 : 0.06 + r() * 0.3;
      g.fillStyle = r() < 0.12 ? `rgba(255,225,200,${a.toFixed(3)})` : `rgba(215,228,255,${a.toFixed(3)})`;
      const sz = r() < 0.04 ? 1.4 : r() < 0.4 ? 0.9 : 0.6;
      g.fillRect(x, y, sz, sz);
    }
    return c;
  }

  toggle() {
    if (this.dir === -1) this.now();
    else if (this.dir === 1 || (this.active && this.p > 0)) this.back();
    else this.go();
  }

  go() {
    this.#ensure();
    this.planetsAt = planetLongitudes();
    this.active = true;
    this.dir = 1;
    document.body.classList.add('cosmic');
    this.canvas.hidden = false;
    if (this.front) this.front.hidden = false;
    this.globe.hideStars = true;
    this.globe.dirty = true;
    this.ui.setMode('space');
    this.ui.hideWelcomeBack?.();
    if (this.reduce) {
      // 動きを減らす設定：宇宙の全体の絵を1枚だけ描いて止める（描き続けない）
      this.p = 4;
      this.q = 1;
      this.dir = 0;
      this.time = 0;
      this.#showText();
      requestAnimationFrame(() => {
        this.textRect = this.#textBox();
        this.#draw();
      });
      return;
    }
    if (!this.raf) this.raf = requestAnimationFrame((t) => this.#loop(t));
  }

  // 土星の輪（後ろ半分を先に、前半分をあとで描いて、球の前後を分ける）
  // 土星の輪：何本もの帯を重ねた平たい輪。内側のC環はうすく、B環は明るく、カッシーニの間隙をあけてA環。
  // 輪の手前半分は本体の上に、奥の半分は本体の後ろに描く
  #ring(x, y, r, k, front) {
    const ctx = this.ctx;
    const tilt = -0.2;
    const flat = Math.max(0.18, k * 0.5);
    const BANDS = [
      [1.24, 1.52, 'rgba(150,135,110,0.28)'], // C環
      [1.52, 1.72, 'rgba(232,214,170,0.78)'], // B環（内側）
      [1.72, 1.95, 'rgba(246,230,190,0.9)'], // B環（外側、いちばん明るい）
      [2.03, 2.2, 'rgba(214,198,160,0.62)'], // A環（カッシーニの間隙の外）
      [2.2, 2.27, 'rgba(190,176,142,0.42)'],
    ];
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(tilt);
    // 手前／奥の半分だけを残す
    ctx.beginPath();
    ctx.rect(-r * 3, front ? 0 : -r * 3, r * 6, r * 3);
    ctx.clip();
    ctx.scale(1, flat);
    for (const [i0, i1, col] of BANDS) {
      ctx.strokeStyle = col;
      ctx.lineWidth = Math.max(0.5, (i1 - i0) * r);
      ctx.beginPath();
      ctx.arc(0, 0, ((i0 + i1) / 2) * r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  // 地球へすぐもどる（もどる途中で、もう一度ボタンや Esc を押したとき）
  now() {
    this.#hideText();
    this.ui.setMode('earth');
    this.p = 0;
    this.q = 0;
    this.#draw();
    this.#finish();
  }

  // 文字の位置（星や銀河をその場所では薄くする）
  #textBox() {
    const c = this.canvas.getBoundingClientRect();
    const box = (els) => {
      const rs = els.map((e) => e?.getBoundingClientRect?.()).filter((r) => r && r.width);
      if (!rs.length) return null;
      const x0 = Math.min(...rs.map((r) => r.left));
      const y0 = Math.min(...rs.map((r) => r.top));
      const x1 = Math.max(...rs.map((r) => r.right));
      const y1 = Math.max(...rs.map((r) => r.bottom));
      return { x: x0 - c.left, y: y0 - c.top, w: x1 - x0, h: y1 - y0 };
    };
    const q = (sel) => this.ui.text?.querySelector?.(sel);
    this.noteRect = box([q('.cosmos-note')]);
    return box([q('.cosmos-ja'), q('.cosmos-en')]);
  }

  back() {
    this.#hideText();
    this.ui.setMode('earth');
    if (this.reduce) {
      this.p = 0;
      this.q = 0;
      this.#finish();
      return;
    }
    this.dir = -1;
  }

  #finish() {
    this.dir = 0;
    this.active = false;
    document.body.classList.remove('cosmic');
    this.canvas.hidden = true;
    if (this.front) {
      this.fctx.clearRect(0, 0, this.w, this.h);
      this.front.hidden = true;
    }
    this.globe.hideStars = false;
    this.globe.sunBoost = 0;
    this.globe.realism = 0;
    this.globe.setView?.(null);
    this.globe.canvas.style.transform = '';
    this.globe.canvas.style.opacity = '';
    this.globe.skipDraw = false;
    this.globe.dirty = true;
    cancelAnimationFrame(this.raf);
    this.raf = null;
    this.ui.welcomeBack?.(); // 「おかえり」をうっすら出す
  }

  #showText() {
    if (this.textShown) return;
    this.textShown = true;
    this.ui.text.hidden = false;
    requestAnimationFrame(() => {
      this.ui.text.classList.add('on');
      this.textRect = this.#textBox();
    });
  }
  #hideText() {
    this.textShown = false;
    this.ui.text.classList.remove('on');
    this.ui.text.hidden = true;
  }

  #loop(t) {
    // 進み方は実際の経過時間で決める（重い端末でコマ数が少なくても、同じ秒数で進む）
    const dt = this.last ? Math.min(0.5, (t - this.last) / 1000) : 0;
    this.last = t;
    this.time = (this.time || 0) + dt;
    if (this.dir === 1) {
      // 宇宙へ：約26秒。ゆっくり動き出し、速くなりすぎず、ゆっくり止まる
      this.q = clamp((this.q ?? 0) + dt / 26);
      this.p = 4 * ease(this.q);
      // 文字は、銀河の形ができたころから出しはじめる（最後まで待たない）
      if (this.q >= 0.72) this.#showText();
      if (this.q >= 1) this.dir = 0;
    } else if (this.dir === -1) {
      // 地球へもどる：約10秒
      this.q = clamp((this.q ?? 1) - dt / 10);
      this.p = 4 * ease(this.q);
      if (this.q <= 0) {
        this.q = 0;
        this.p = 0;
        this.#draw();
        this.#finish();
        return;
      }
    }
    // 着いて止まっている間（ゆっくり回るだけ）は、1秒に30コマまでにして、端末の負担と電池の減りを抑える
    if (this.dir === 0 && this.lastDraw && t - this.lastDraw < 32) {
      this.raf = requestAnimationFrame((n) => this.#loop(n));
      return;
    }
    this.lastDraw = t;
    this.#draw();
    this.raf = requestAnimationFrame((n) => this.#loop(n));
  }

  #drawMoon(x, y, rad, sunAng, alpha) {
    drawMoonShape(this.fctx || this.ctx, x, y, rad, sunAng, FULL_MOON, alpha);
  }

  #draw() {
    const { ctx, w, h, p } = this;
    const g = this.globe;
    const time = this.reduce ? 0 : this.time || 0;
    ctx.clearRect(0, 0, w, h);
    this.fctx?.clearRect(0, 0, w, h);
    const cx = g.cx ?? w / 2;
    const cy = g.cy ?? h / 2;
    const R = (g.baseRadius || Math.min(w, h) * 0.4) * (g.zoom || 1);

    // 背景の空（天の川の帯）：宇宙へ出るほどはっきり。ゆっくり回り続ける
    const skyA = 0.25 + 0.75 * band(p, 0.8, 2.6);
    ctx.save();
    ctx.globalAlpha = skyA;
    ctx.translate(w / 2, h / 2);
    ctx.rotate(time * 0.004);
    const SD = Math.max(this.sky.width, Math.ceil(Math.hypot(this.w, this.h)));
    ctx.drawImage(this.sky, -SD / 2, -SD / 2, SD, SD);
    ctx.restore();

    // 手前の星：はじめは今の地球儀と同じく「夜側は濃く、昼側は薄く」、宇宙の規模になるにつれてそろえる
    let nx = 0;
    let ny = 0;
    if (g.nightDir) [nx, ny] = g.nightDir();
    const dirW = 1 - band(p, 1.6, 3.2);
    const span = Math.max(w, h) * 0.75;
    const starFade = 1 - 0.5 * band(p, 3.0, 4.0);
    const drift = time * 1.5; // ごくゆっくり流れる（px/秒）
    for (const s of this.stars) {
      const x = (((s.x * w + drift * (0.3 + s.b * 0.4)) % w) + w) % w;
      const y = s.y * h;
      const toward = clamp(((x - cx) / span) * nx + ((y - cy) / span) * ny, -1, 1);
      const f = Math.pow((toward + 1) / 2, 1.3);
      const dirA = 0.2 + 0.8 * f;
      const tw = this.reduce ? 1 : 0.85 + 0.15 * Math.sin((time * 2 * Math.PI) / s.per + s.ph); // 2〜4秒で、ほのかに
      const a = s.b * (dirA * dirW + 0.75 * (1 - dirW)) * tw * starFade;
      if (a < 0.03) continue;
      if (s.s > 1.2) {
        ctx.fillStyle = `rgba(210,222,255,${(a * 0.18).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(x, y, s.s * 3, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = `rgba(232,238,255,${a.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(x, y, s.s, 0, Math.PI * 2);
      ctx.fill();
    }

    // 太陽の向き：地球儀の昼側（実際に太陽が照らしている側）。太陽はそちらから現れ、地球を照らす
    const nl = Math.hypot(nx, ny);
    const sdx = nl > 0.05 ? -nx / nl : 0.85;
    const sdy = nl > 0.05 ? -ny / nl : -0.5;
    // 太陽系の平面（黄道面）は、少し斜めから見下ろす（K＝縦のつぶれ具合）
    const K = 0.5;
    // 平面の中で、地球から見た太陽の向き。画面上では、地球儀の昼側の向きと同じになるようにする
    const th = Math.atan2(sdy / K, sdx);
    const se = Math.exp(-p * 2.0); // 地球の縮み方
    // 地球の軌道の大きさ（画面上）。銀河へ向かうところでは、太陽系ごと点のように小さくなっていく
    const orbit1 = Math.min(w, h) * 0.3 * Math.exp(-(p - 1.6) * 1.5 - Math.max(0, p - 2.0) * 2.4);
    // 視点を太陽系の中心へ移すのは、長い時間をかけて少しずつ（急に真ん中へ飛ばない）
    const toSun = band(p, 0.85, 2.9);
    const sunX = cx + Math.cos(th) * orbit1;
    const sunY = cy + Math.sin(th) * orbit1 * K;
    const ox = (sunX - cx) * toSun;
    const oy = (sunY - cy) * toSun;
    const ex = cx - ox;
    const ey = cy - oy;
    // 地球儀は、絵そのものを小さく描いて動かす（画面のふちで光が切れた跡が出ないように）
    g.setView?.(p > 0 ? { s: se, ox, oy } : null);
    g.canvas.style.opacity = String(1 - band(p, 1.55, 2.1));
    // 地球儀が見えなくなっている間は、地球儀の側の描画を休ませる（電池と処理の節約）
    g.skipDraw = p >= 2.1;
    // 宇宙へ出ると、地球儀の絵柄を少しずつ写真のような色合いへ（地球儀だけの画面は、いつもの絵柄のまま）
    const real = band(p, 0.03, 0.5); // 地球が大きく見えているうちに、写真のような地球へ
    if (Math.abs((g.realism || 0) - real) > 0.002) g.realism = real;

    // 太陽の光：画面の外から、まず光だけがじわっと差し込み、やがて太陽が姿を見せて地球を照らす
    // 線は描かず、にじむ光（発光とぼかし）と、動かない表面の模様だけで表す。明るさは急に変えない
    const sunA = band(p, 0.5, 1.5) * (1 - band(p, 2.4, 2.95));
    const lit = sunA * (1 - band(p, 1.6, 2.1)); // 地球を照らす光（地球が見えている間だけ）
    g.sunBoost = lit;
    g.dirty = true;
    const sx = sunX - ox;
    const sy = sunY - oy;
    const sr = Math.max(1.6, orbit1 * 0.12);
    if (sunA > 0.01) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      // 画面全体にうっすら届く、暖かい光
      const big = Math.max(w, h) * 1.1;
      const hg = ctx.createRadialGradient(sx, sy, 0, sx, sy, big);
      hg.addColorStop(0, `rgba(255,206,145,${(0.3 * sunA).toFixed(3)})`);
      hg.addColorStop(0.2, `rgba(255,178,118,${(0.12 * sunA).toFixed(3)})`);
      hg.addColorStop(0.55, `rgba(255,150,100,${(0.035 * sunA).toFixed(3)})`);
      hg.addColorStop(1, 'rgba(255,150,100,0)');
      ctx.fillStyle = hg;
      ctx.fillRect(0, 0, w, h);
      // 地球へ向かって、やわらかく伸びる光
      if (lit > 0.01) {
        const L = Math.hypot(ex - sx, ey - sy);
        ctx.save();
        ctx.translate((sx + ex) / 2, (sy + ey) / 2);
        ctx.rotate(Math.atan2(ey - sy, ex - sx));
        ctx.scale(1, 0.32);
        const eg = ctx.createRadialGradient(0, 0, 0, 0, 0, L * 0.62);
        eg.addColorStop(0, `rgba(255,222,180,${(0.07 * lit).toFixed(3)})`);
        eg.addColorStop(1, 'rgba(255,222,180,0)');
        ctx.fillStyle = eg;
        ctx.beginPath();
        ctx.arc(0, 0, L * 0.62, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      // 光冠：大きなにじみを何重にも重ねる
      for (const [kk, col] of [
        [30, 'rgba(255,170,100,0.06)'],
        [14, 'rgba(255,180,110,0.15)'],
        [6, 'rgba(255,205,145,0.3)'],
        [2.8, 'rgba(255,230,190,0.55)'],
        [1.6, 'rgba(255,246,225,0.8)'],
      ]) {
        const gr = ctx.createRadialGradient(sx, sy, sr * 0.6, sx, sy, sr * kk);
        gr.addColorStop(0, col);
        gr.addColorStop(
          0.35,
          col.replace(/[\d.]+\)$/, (m) => `${(parseFloat(m) * 0.45).toFixed(3)})`),
        );
        gr.addColorStop(1, 'rgba(255,200,130,0)');
        ctx.globalAlpha = sunA;
        ctx.fillStyle = gr;
        ctx.beginPath();
        ctx.arc(sx, sy, sr * kk, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      // コロナとプロミネンス（写真のように）：
      //  ・コロナ：太陽のまわりに、白っぽい光のすじが放射状にうっすら広がる（ごくゆっくり形が変わる）
      //  ・プロミネンス：ふちに、赤みがかった小さな炎のかたまりが、ちぎれた雲のように張りつく。
      //    数秒〜十数秒かけて、ふくらんだり、ゆらいだりする。点滅はしない。太陽が小さいときは描かない
      if (sr > 5 && !this.reduce) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = sunA;
        for (const c of this.corona) {
          const ang = c.a + Math.sin(time * 0.05 + c.ph) * 0.04;
          const len = sr * (1.4 + c.len * (0.85 + 0.15 * Math.sin(time * c.sp + c.ph)));
          ctx.save();
          ctx.translate(sx, sy);
          ctx.rotate(ang);
          ctx.scale(1, c.wd);
          const cg = ctx.createRadialGradient(0, 0, sr * 0.9, 0, 0, len);
          cg.addColorStop(0, 'rgba(255,240,220,0.07)');
          cg.addColorStop(1, 'rgba(255,240,220,0)');
          ctx.fillStyle = cg;
          ctx.beginPath();
          ctx.arc(0, 0, len, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
        for (const f of this.flares) {
          const life = 0.5 + 0.5 * Math.sin(time * f.sp + f.ph);
          const ang = f.a + time * 0.004;
          for (const pf of f.puffs) {
            // かたまりの1つぶ：ふちからの高さと横ずれが、時間でゆっくり変わる
            const h = sr * pf.h * (0.55 + 0.45 * life) * (1 + 0.15 * Math.sin(time * f.sp * 1.3 + pf.ph));
            const a2 = ang + pf.da + Math.sin(time * f.sp * 0.8 + pf.ph) * 0.012;
            const x = sx + Math.cos(a2) * (sr + h);
            const y = sy + Math.sin(a2) * (sr + h);
            const rad = sr * pf.r * (0.7 + 0.3 * life);
            const pg = ctx.createRadialGradient(x, y, 0, x, y, rad);
            pg.addColorStop(0, `rgba(255,120,90,${(0.22 * pf.a * (0.6 + 0.4 * life)).toFixed(3)})`);
            pg.addColorStop(1, 'rgba(255,90,70,0)');
            ctx.fillStyle = pg;
            ctx.beginPath();
            ctx.arc(x, y, rad, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        ctx.restore();
      }
      // 太陽の表面（ふつうの重ね方で、模様が見えるように）
      ctx.save();
      ctx.globalAlpha = sunA;
      ctx.drawImage(this.sunImg, sx - sr, sy - sr, sr * 2, sr * 2);
      ctx.restore();
      // 少しまぶしいくらいの、白い光のかぶり
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const bl = ctx.createRadialGradient(sx, sy, sr * 0.2, sx, sy, sr * 1.9);
      bl.addColorStop(0, `rgba(255,252,240,${(0.42 * sunA).toFixed(3)})`);
      bl.addColorStop(0.5, `rgba(255,236,200,${(0.22 * sunA).toFixed(3)})`);
      bl.addColorStop(1, 'rgba(255,220,170,0)');
      ctx.fillStyle = bl;
      ctx.beginPath();
      ctx.arc(sx, sy, sr * 1.9, 0, Math.PI * 2);
      ctx.fill();
      // 横に細く伸びる光のすじ（まぶしさ。ごく淡く、動かさない）
      ctx.translate(sx, sy);
      ctx.scale(1, 0.035);
      const st = ctx.createRadialGradient(0, 0, 0, 0, 0, sr * 9);
      st.addColorStop(0, `rgba(255,240,215,${(0.3 * sunA).toFixed(3)})`);
      st.addColorStop(1, 'rgba(255,240,215,0)');
      ctx.fillStyle = st;
      ctx.beginPath();
      ctx.arc(0, 0, sr * 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // 月：はじめは画面の下に、大きな月の表面（地平線）がのぞく。視点が引くにつれて丸い月になり、
    // 地球のそばの「今の月の位置」へ吸い寄せられていく（途中で止まらない）
    const mu = clamp(p / 1.8);
    const moonA = 1 - band(p, 1.45, 1.95);
    if (moonA > 0.01 && p > 0) {
      const sunAng = Math.atan2(sdy, sdx);
      const m = ease(mu);
      const r0 = Math.max(w, h) * 0.95;
      const startX = cx + w * 0.12;
      const startY = h + r0 * 0.985; // 月の上のふちが、画面の下のふちに少しだけ見える
      // 月の位置：宇宙の場面の月は満月で描くので、地球をはさんで太陽の反対側に置く
      const elong = Math.PI;
      const thm = th - elong;
      const d1 = R * se * 2.2 + 8;
      const endX = ex + Math.cos(thm) * d1;
      const endY = ey + Math.sin(thm) * d1 * K;
      const r1 = Math.max(2.5, R * se * 0.27);
      // 上のふちの高さは早めに上がり（大きな月面が画面の下を占める）、大きさはゆっくり小さくなる
      const mc = 1 - Math.pow(1 - m, 2.5);
      const mr = Math.exp(Math.log(r0) + (Math.log(r1) - Math.log(r0)) * Math.pow(m, 1.7));
      const top = startY - r0 + (endY - r1 - (startY - r0)) * mc;
      const mx = startX + (endX - startX) * mc;
      const my = top + mr;
      this.#drawMoon(mx, my, mr, sunAng, moonA * band(p, 0, 0.06));
    }

    // 惑星：太陽が見えてくると、それぞれの軌道の上の「今の位置」へ、ゆっくり集まってくる
    // 並び順・軌道の向き・今の位置は実際の値。軌道の大きさは平方根で縮めている。集まったあとは、内側ほど速く公転する
    const gather = ease(band(p, 1.15, 2.1));
    // 吸い込まれる：星が群がってくるのに合わせて、惑星が太陽へ寄りながら小さくなり、太陽系が一つの光の点になる
    const absorb = ease(band(p, 2.0, 2.5));
    const solA = band(p, 1.15, 1.6) * (1 - band(p, 2.3, 2.55));
    if (solA > 0.01) {
      const Lg = this.planetsAt;
      const run = Math.max(0, p - 2.0) * 1.6; // 集まったあとの公転の進み（地球の公転の角度）
      ctx.save();
      for (const pl of PLANETS) {
        const or = orbit1 * Math.sqrt(pl.a);
        if (pl.id === 'earth' && p < 1.9) continue; // そのあいだは、地球儀そのものが地球
        // ケプラーの法則：公転の速さは、軌道の大きさの1.5乗に反比例。すべての惑星が同じ向きに回る
        const a0 = th + Math.PI - ((Lg[pl.id] || 0) - (Lg.earth || 0)) * RAD - run * Math.pow(pl.a, -1.5);
        const a = a0 + (1 - gather) * 0.9; // 集まる前は、公転の向きの少し後ろから（回る向きと同じ向きに集まる）
        const dist = or * (1 + (1 - gather) * 0.6) * (1 - 0.92 * absorb);
        const px = sx + Math.cos(a) * dist;
        const py = sy + Math.sin(a) * dist * K;
        const pr = pl.r * (0.85 + 0.15 * gather) * (1 - 0.6 * absorb);
        // 太陽の側が明るい
        const lx = sx - px;
        const ly = sy - py;
        const ll = Math.hypot(lx, ly) || 1;
        ctx.globalAlpha = solA * (0.3 + 0.7 * gather);
        if (pl.ring) this.#ring(px, py, pr, K, false);
        const pg = ctx.createRadialGradient(px + (lx / ll) * pr * 0.45, py + (ly / ll) * pr * 0.45, 0, px, py, pr);
        pg.addColorStop(0, '#fffaf0');
        pg.addColorStop(0.35, pl.c);
        pg.addColorStop(1, 'rgba(14,18,26,0.95)');
        ctx.fillStyle = pg;
        ctx.beginPath();
        ctx.arc(px, py, pr, 0, Math.PI * 2);
        ctx.fill();
        if (pl.bands) {
          ctx.save();
          ctx.beginPath();
          ctx.arc(px, py, pr, 0, Math.PI * 2);
          ctx.clip();
          ctx.fillStyle = pl.id === 'saturn' ? 'rgba(170,140,90,0.22)' : 'rgba(150,100,70,0.25)';
          const ys = pl.id === 'saturn' ? [-0.55, -0.25, 0.05, 0.35] : [-0.45, -0.1, 0.3];
          ctx.save();
          ctx.translate(px, py);
          ctx.rotate(pl.id === 'saturn' ? -0.2 : 0);
          for (const yy of ys) ctx.fillRect(-pr, yy * pr, pr * 2, pr * 0.13);
          ctx.restore();
          ctx.restore();
        }
        if (pl.ring) this.#ring(px, py, pr, K, true);
      }
      ctx.restore();
    }

    // 天の川銀河：別に作った銀河の絵を重ねるのではなく、星そのものが集まって銀河になる
    //  1. 画面に散らばっていた星が、点のように小さくなった太陽系のまわりへ、ゆっくり群がってくる（星の塊）
    //  2. 塊が回りながらほどけて、棒のある渦巻きの形に広がっていく。太陽系は、その腕の中の一点になる
    //  3. 形ができてから、ぼんやりした光のもやと暗い塵の帯を、うっすら足す
    // もどるときは、同じ道をさかのぼる（渦がほどけて塊になり、星が散って太陽系が大きくなる）
    const galA = band(p, 1.9, 2.3) * (1 - (this.small ? 0.3 : 0.22) * band(p, 3.3, 4.0));
    const gTop = this.small ? 0.29 : 0.34;
    if (galA > 0.01) {
      const mn = Math.min(w, h);
      // 渦巻きの大きさ：塊からほどけるときは小さめから、最後の大きさへ
      const gk = ease(band(p, 2.45, 3.7));
      // スマホの縦向き（幅が狭い）では、最後の大きさを広めにとる（小さく見えすぎないように）
      const gEnd = this.small ? (w < h ? 0.52 : 0.4) : 0.28;
      const gStart = this.small ? 0.62 : 0.5;
      const gr = mn * (gStart + (gEnd - gStart) * gk);
      const tiltY = 1 - 0.58 * band(p, 2.6, 3.6); // 真上から見下ろす形から、斜めに傾いた姿へ
      const base = -0.35;
      const spin = time * 0.03 + p * 0.8; // 遠ざかる間も、回り続ける
      const cosB = Math.cos(base);
      const sinB = Math.sin(base);
      const proj = (rad, ang) => {
        const lx = Math.cos(ang) * rad * gr;
        const ly = Math.sin(ang) * rad * gr * tiltY;
        return [lx * cosB - ly * sinB, lx * sinB + ly * cosB];
      };
      // 渦巻きの中心：はじめは「太陽系の場所が今の太陽に重なる」位置、最後は画面の上寄りの真ん中
      const sunAngNow = SUN_IN_GALAXY.ang + spin + (time * 0.012) / (0.35 + SUN_IN_GALAXY.rad);
      const [spx, spy] = proj(SUN_IN_GALAXY.rad, sunAngNow);
      const k2 = ease(band(p, 2.5, 3.7));
      const gcx = sx - spx + (w / 2 - (sx - spx)) * k2;
      const gcy = sy - spy + (h * gTop - (sy - spy)) * k2;
      // 塊の中心は太陽系。塊は、ゆっくり渦を巻く
      const clumpR = mn * 0.16;
      const cRot = time * 0.05 + p * 0.6;
      const cc = Math.cos(cRot);
      const cs = Math.sin(cRot);
      const far = Math.max(w, h);
      const gather = band(p, 1.95, 2.6); // 群がる（星ごとに遅れをつける。惑星が吸い込まれるのと同じ時間）
      const form = band(p, 2.5, 3.45); // 太陽系が光の点になってから、ほどけて渦巻きへ
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const zs = clamp(gr / 320, 0.6, 1.1);
      for (const st of this.gstars) {
        const gi = ease(clamp((gather - st.dl) / (1 - 0.4)));
        const fi = ease(clamp((form - st.dl * 0.8) / (1 - 0.3)));
        if (gi <= 0) continue;
        let x;
        let y;
        if (fi >= 1) {
          // 銀河の形ができたあと（いちばん長く見る場面）は、渦巻きの中の場所だけを計算して軽くする
          const [qx, qy] = proj(st.rad, st.ang + spin + (time * 0.012) / (0.35 + st.rad));
          x = gcx + qx;
          y = gcy + qy;
        } else {
          // 散らばっている場所（太陽系から遠く。ゆっくり回っている）
          const sa = st.sa + time * 0.01;
          const x0 = sx + Math.cos(sa) * st.sd * far;
          const y0 = sy + Math.sin(sa) * st.sd * far * 0.8;
          // 塊の中の場所
          const x1 = sx + (st.cx * cc - st.cy * cs) * clumpR;
          const y1 = sy + (st.cx * cs + st.cy * cc) * clumpR;
          x = x0 + (x1 - x0) * gi;
          y = y0 + (y1 - y0) * gi;
          if (fi > 0) {
            // 渦巻きの中の場所（内側ほど少し速く回る）
            const [qx, qy] = proj(st.rad, st.ang + spin + (time * 0.012) / (0.35 + st.rad));
            x += (gcx + qx - x) * fi;
            y += (gcy + qy - y) * fi;
          }
        }
        if (x < -4 || y < -4 || x > w + 4 || y > h + 4) continue;
        const tw = st.sparkle && !this.reduce ? 0.7 + 0.3 * Math.sin((time * 2 * Math.PI) / st.per + st.ph) : 1;
        // 塊になっている間は、星が重なって明るくなりすぎないよう少し控えめ
        const dens = 0.55 + 0.45 * Math.max(1 - gi, fi);
        const a = st.a * galA * tw * (0.25 + 0.75 * gi) * dens;
        if (a < 0.02) continue;
        const sz = st.s * zs;
        if (st.sparkle) {
          const sg = ctx.createRadialGradient(x, y, 0, x, y, sz * 2.6);
          sg.addColorStop(0, `rgba(${st.c},${(a * 0.35).toFixed(3)})`);
          sg.addColorStop(1, `rgba(${st.c},0)`);
          ctx.fillStyle = sg;
          ctx.fillRect(x - sz * 2.6, y - sz * 2.6, sz * 5.2, sz * 5.2);
        }
        ctx.fillStyle = `rgba(${st.c},${a.toFixed(3)})`;
        ctx.fillRect(x - sz / 2, y - sz / 2, sz, sz);
      }
      // 塊のあいだだけ、太陽系のまわりにほのかな光のまとまり（星が集まり、太陽系を吸い込んだ感じ）
      const glowA = galA * band(p, 2.2, 2.55) * (1 - band(p, 2.75, 3.2));
      if (glowA > 0.01) {
        const cg = ctx.createRadialGradient(sx, sy, 0, sx, sy, clumpR * 1.6);
        cg.addColorStop(0, `rgba(255,232,200,${(0.16 * glowA).toFixed(3)})`);
        cg.addColorStop(0.4, `rgba(220,215,255,${(0.06 * glowA).toFixed(3)})`);
        cg.addColorStop(1, 'rgba(200,200,255,0)');
        ctx.fillStyle = cg;
        ctx.fillRect(sx - clumpR * 1.6, sy - clumpR * 1.6, clumpR * 3.2, clumpR * 3.2);
      }
      // 形ができてから、もやと塵の帯を足す
      const hazeA = galA * 0.9 * band(p, 3.0, 3.6);
      if (hazeA > 0.01) {
        const drawImg = (img, alpha) => {
          ctx.save();
          ctx.globalAlpha = alpha;
          ctx.translate(gcx, gcy);
          ctx.rotate(base);
          ctx.scale(1, tiltY);
          ctx.rotate(spin);
          ctx.drawImage(img, -gr, -gr, gr * 2, gr * 2);
          ctx.restore();
        };
        drawImg(this.haze, hazeA);
        ctx.globalCompositeOperation = 'source-over';
        drawImg(this.dust, hazeA);
      }
      ctx.restore();
    }

    // 宇宙全体：小さな銀河たちが、それぞれの速さで回り、ゆっくり流れ、少しずつ近づいたり遠のいたりする
    const farA = band(p, 3.0, 3.9);
    const tb = this.textShown ? this.textRect : null;
    if (farA > 0.01) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const pan = time * 0.0025;
      for (const f of this.far) {
        let x = ((f.x + pan * (0.4 + f.s / 60)) % 1.3) - 0.15;
        x = x * w;
        const y = f.y * h;
        if (Math.hypot(x - w / 2, y - h * gTop) < Math.min(w, h) * 0.17) continue; // 天の川銀河のまわりはあける
        if (tb && x > tb.x - 30 && x < tb.x + tb.w + 30 && y > tb.y - 24 && y < tb.y + tb.h + 24) continue; // 文字の上には置かない
        const nb = this.noteRect;
        if (nb && y > nb.y - 20 && y < nb.y + nb.h + 20) continue;
        const zoom = 1 + 0.12 * Math.sin(time * 0.05 + f.ph);
        const sz = f.s * zoom;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(f.rot + time * f.spin);
        ctx.scale(1, f.tilt);
        ctx.globalAlpha = farA * f.a;
        ctx.drawImage(this.sprites[f.k], -sz, -sz, sz * 2, sz * 2);
        ctx.restore();
      }
      ctx.restore();
    }

    // 文字の後ろだけ、背景をそっと暗くして読みやすく（ふちはぼかす）
    if (tb && farA > 0.01) {
      const tx = tb.x + tb.w / 2;
      const ty = tb.y + tb.h / 2;
      const rr = Math.max(tb.w, tb.h) * 0.62;
      ctx.save();
      ctx.translate(tx, ty);
      ctx.scale(1, Math.min(1, (tb.h + 60) / (tb.w + 60)) * 1.4);
      const sc = ctx.createRadialGradient(0, 0, 0, 0, 0, rr);
      sc.addColorStop(0, `rgba(6,9,15,${(0.62 * farA).toFixed(3)})`);
      sc.addColorStop(0.6, `rgba(6,9,15,${(0.4 * farA).toFixed(3)})`);
      sc.addColorStop(1, 'rgba(6,9,15,0)');
      ctx.fillStyle = sc;
      ctx.beginPath();
      ctx.arc(0, 0, rr, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
}

// 画面の部品をつなぐ（main.js から呼ぶ）
export function setupCosmos(globe, t) {
  const btn = document.getElementById('btn-space');
  const canvas = document.getElementById('cosmos');
  const text = document.getElementById('cosmos-text');
  if (!btn || !canvas || !text || !globe) return null;
  const wb = document.getElementById('welcome-back');
  let wbTimer = null;
  const ui = {
    text,
    // 地球へもどったとき：「おかえりなさい。」を小さく、うっすら出して消す（動きを減らす設定でも、文字の出し入れだけ）
    welcomeBack() {
      if (!wb) return;
      clearTimeout(wbTimer);
      // パソコン：地球儀のすぐ上の真ん中に出す（左下の説明の枠と重ならないように）。上に場所がなければ、地球儀の上のほうに重ねる
      if (window.matchMedia('(min-width: 861px)').matches && globe.cx) {
        const R = (globe.baseRadius || 200) * (globe.zoom || 1);
        const head = document.querySelector('.topbar')?.getBoundingClientRect().bottom || 60;
        let top = globe.cy - R - 92; // 枠の上下の余白（ぼかしの広がり）の分だけ上へ
        if (top < head - 20) top = globe.cy - R * 0.62 - 24;
        wb.style.left = `${Math.round(globe.cx)}px`;
        wb.style.top = `${Math.round(top)}px`;
      } else {
        wb.style.left = '';
        wb.style.top = '';
      }
      wb.hidden = false;
      // 文字が出ている間は、国名の札などを少しだけ薄くして、文字を読みやすくする
      document.body.classList.add('wb-on');
      // 現在地を使っている人には、地球儀の自分の場所に小さな灯をともす
      globe.welcomeHome?.();
      requestAnimationFrame(() => wb.classList.add('on'));
      // 少しのあいだ浮かべて、ゆっくり消す
      wbTimer = setTimeout(() => {
        wb.classList.remove('on');
        document.body.classList.remove('wb-on');
        wbTimer = setTimeout(() => (wb.hidden = true), 3000);
      }, 4200);
    },
    hideWelcomeBack() {
      if (!wb) return;
      clearTimeout(wbTimer);
      wb.classList.remove('on');
      document.body.classList.remove('wb-on');
      wb.hidden = true;
    },
    setMode(m) {
      btn.textContent = t(m === 'space' ? 'cosmos.back' : 'cosmos.go');
      btn.setAttribute('aria-pressed', String(m === 'space'));
    },
  };
  const cosmos = new Cosmos(globe, canvas, ui);
  btn.addEventListener('click', () => {
    cosmos.toggle();
    if (!cosmos.active) btn.focus({ preventScroll: true });
  });
  // Esc で、いつでも地球へもどる
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !cosmos.active) return;
    if (cosmos.dir === -1)
      cosmos.now(); // もどる途中なら、すぐ地球へ
    else cosmos.back();
  });
  ui.setMode('earth');
  return cosmos;
}
