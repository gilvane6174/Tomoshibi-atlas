// 地球儀の描画と操作（自動回転・ドラッグ・ホイール拡大・指定地点への移動）。
// d3-geo（同梱）の正射図法で canvas に描く。外部通信なし。

const d3 = window.d3;

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const RAD = Math.PI / 180;

// 太陽直下点（経度・緯度）の概算。外部データを使わず、日時だけから計算する
export function subsolarPoint(date = new Date()) {
  const n = date.getTime() / 86400000 + 2440587.5 - 2451545.0;
  const L = 280.46 + 0.9856474 * n;
  const g = (357.528 + 0.9856003 * n) * RAD;
  const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD;
  const eps = (23.439 - 0.0000004 * n) * RAD;
  const dec = Math.asin(Math.sin(eps) * Math.sin(lambda));
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda)) / RAD;
  const gmst = 280.46061837 + 360.98564736629 * n;
  const lon = ((((ra - gmst) % 360) + 540) % 360) - 180;
  return [lon, dec / RAD];
}

// その地点の「夜・夜明け・昼・夕暮れ」を太陽高度から判定する（概算）
export function sunPhase(lon, lat, date = new Date()) {
  const [slon, slat] = subsolarPoint(date);
  const H = ((((lon - slon) % 360) + 540) % 360) - 180;
  const h = Math.asin(Math.sin(lat * RAD) * Math.sin(slat * RAD) + Math.cos(lat * RAD) * Math.cos(slat * RAD) * Math.cos(H * RAD)) / RAD;
  if (h < -6) return 'night';
  if (h < 6) return H < 0 ? 'dawn' : 'dusk';
  return 'day';
}

export class Globe {
  constructor(canvas, shapes, { onCountryClick, onFrame, getInsets } = {}) {
    this.canvas = canvas;
    this.getInsets = getInsets || (() => ({ top: 0, right: 0, bottom: 0, left: 0 }));
    this.ctx = canvas.getContext('2d');
    this.shapes = shapes;
    this.onCountryClick = onCountryClick;
    this.onFrame = onFrame;
    this.projection = d3.geoOrthographic().clipAngle(90).precision(0.6);
    this.path = d3.geoPath(this.projection, this.ctx);
    this.graticule = d3.geoGraticule10();
    this.rotation = [-135, -18]; // 初期表示：アジア太平洋
    this.tilt = 14; // 地軸を少し傾けて、北半球が見やすい角度に（度）
    this.zoom = 1;
    this.view = null; // 宇宙へ出ていく間の、見かけの縮み方と位置（cosmos.js が決める）
    this.speed = 2.4; // 度/秒（ゆっくり）
    this.curSpeed = 0; // いまの回転の速さ（止まる・動き出すときに、じわっと変える）
    // 視点のゆるやかな移り変わり：自動で回っている間だけ、2分ほどかけて少し寄って北半球を見下ろし、また引く
    this.driftT = 0;
    this.driftS = 0;
    this.drift = !reduceMotion;
    this.arcs = []; // テーマでつなぐ光の弧（[[経度, 緯度], [経度, 緯度]] の組）
    // 開いたとき：宇宙の遠くから日本へゆっくり寄っていく（動きを減らす設定のときは省く）
    this.intro = reduceMotion ? null : { start: null, dur: 3600, from: [-60, -5], to: [-138, -30], z0: 0.32 };
    this.autoRotate = !reduceMotion;
    this.userPaused = reduceMotion;
    this.dots = [];
    this.selectedId = null;
    this.waves = null; // 選んだ国のまわりの海の波（{ marks, a: 濃さ 0〜1, on }）
    this.here = null; // 現在地の印（端末内でのみ保持）
    this.stars = makeStars(1500);
    this.accent = '#f2c27a'; // 選んだ国の色（いま見ている分野の色に合わせる）
    this.#updateSun();
    setInterval(() => this.#updateSun(), 60000);
    this.idleTimer = null;
    this.anim = null;
    this.dirty = true;
    this.#bind();
    this.resize();
    requestAnimationFrame((t) => this.#loop(t));
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.w = w;
    this.h = h;
    this.relayout();
  }

  // 上部メニュー・下部ステータス・開いているパネルを避けて、空いた領域の中央に地球儀を置く
  relayout() {
    const i = this.getInsets();
    this.insets = i;
    const aw = Math.max(160, this.w - i.left - i.right);
    const ah = Math.max(160, this.h - i.top - i.bottom);
    this.cx = i.left + aw / 2;
    this.cy = i.top + ah / 2;
    this.baseRadius = Math.max(90, Math.min(aw, ah) * (this.w < 700 ? 0.47 : 0.45));
    this.#applyProjection();
  }

  #updateSun() {
    const [lon, lat] = subsolarPoint();
    this.sun = [lon, lat];
    const anti = [lon + 180 > 180 ? lon - 180 : lon + 180, -lat];
    const circle = (r) => d3.geoCircle().center(anti).radius(r).precision(2)();
    this.night = { golden: circle(96), dark: circle(90), deep: circle(84) };
    this.dirty = true;
  }

  // 宇宙から地球へもどったときに、現在地に灯をともす（現在地を使っていないときは何もしない）
  welcomeHome() {
    if (!this.here) return;
    this.homeGlow = performance.now();
    this.dirty = true;
  }

  setHere(lon, lat) {
    this.here = lon == null ? null : [lon, lat];
    this.dirty = true;
  }

  // 宇宙へ出ていく間：地球儀の絵そのものを小さく描く（絵を縮めて動かすと、画面のふちで切れた光の跡が見えるため）
  setView(v) {
    this.view = v;
    this.#applyProjection();
  }

  #applyProjection() {
    const d = this.driftS;
    let r = Math.max(40, this.baseRadius * this.zoom * (1 + 0.12 * d));
    let tx = this.cx;
    let ty = this.cy + this.baseRadius * 0.1 * d;
    const v = this.view;
    if (v) {
      tx = this.cx + (tx - this.cx) * v.s - v.ox;
      ty = this.cy + (ty - this.cy) * v.s - v.oy;
      r *= v.s;
    }
    this.projection
      .scale(r)
      .translate([tx, ty])
      .rotate([this.rotation[0], this.rotation[1] - 12 * d, this.tilt * (1 - d * 0.3)]);
    this.dirty = true;
  }

  // テーマでつなぐ光の弧
  setArcs(arcs) {
    this.arcs = arcs || [];
    this.arcsStart = performance.now();
    this.dirty = true;
  }

  get center() {
    return [-this.rotation[0], -(this.rotation[1] - 12 * this.driftS)];
  }

  // 地点が手前側に見えているか（0＝中心、1＝縁）を返す。裏側なら null
  visibility(lon, lat) {
    const dist = d3.geoDistance([lon, lat], this.center);
    return dist < Math.PI / 2 ? dist / (Math.PI / 2) : null;
  }
  project(lon, lat) {
    return this.projection([lon, lat]);
  }

  setDots(dots) {
    this.dots = dots;
    this.dirty = true;
  }
  setSelected(id) {
    this.selectedId = id;
    this.#prepareWaves();
    this.dirty = true;
  }
  // 選んだ国のまわりの海に広がる波紋（生まれる半径・消える半径・始まりの時刻）を用意する。海のない国・動きを減らす設定では出さない
  #prepareWaves() {
    const old = this.waves;
    const f = this.selectedId && !reduceMotion && !LANDLOCKED.has(this.selectedId) ? this.shapes?.features.find((x) => x.id === this.selectedId) : null;
    if (!f) {
      if (old) old.on = false; // いまの波は、ゆっくり消える
      return;
    }
    const c = d3.geoCentroid(f);
    const [[w, so], [e, n]] = d3.geoBounds(f);
    const span = Math.max(d3.geoDistance([w, so], [e, n]), 0.02) / RAD;
    const r0 = Math.min(span * 0.5 + 0.8, 25); // 波紋が生まれる半径（国の大きさ。度）
    const R = Math.min(r0 + 11, 38); // 波紋が消える半径（度）
    this.waves = { c, r0, R, a: 0, on: true, t0: performance.now() };
  }
  setAccent(color) {
    if (/^#[0-9a-f]{6}$/i.test(color || '')) this.accent = color;
    this.dirty = true;
  }

  pause(byUser = true) {
    this.autoRotate = false;
    this.curSpeed = 0;
    this.intro = null;
    if (byUser) this.userPaused = true;
    clearTimeout(this.idleTimer);
    this.onRotateState?.();
  }
  play() {
    clearTimeout(this.idleTimer);
    this.userPaused = false;
    this.autoRotate = !reduceMotion;
    this.onRotateState?.();
  }
  reset(done) {
    this.zoom = 1;
    this.driftT = 0;
    this.driftS = 0;
    this.selectedId = null;
    this.#prepareWaves();
    this.flyTo(135, 18, () => {
      this.play();
      done?.();
    });
  }

  // 指定した経度・緯度を正面にして止める
  flyTo(lon, lat, done) {
    // 開いたときの寄り（intro）の途中なら、その続きの大きさまで一緒に戻す（途中で止まって小さいままにならないように）
    const zFrom = this.intro ? this.zoom : null;
    this.pause(true);
    const from = [...this.rotation];
    const to = [-lon, Math.max(-60, Math.min(60, -lat))];
    let dl = to[0] - from[0];
    dl = ((dl + 540) % 360) - 180; // 近い方向に回る
    if (reduceMotion) {
      if (zFrom !== null) this.zoom = 1;
      this.rotation = [from[0] + dl, to[1]];
      this.#applyProjection();
      done?.();
      return;
    }
    const start = performance.now();
    const dur = 1300;
    const d0 = this.driftS;
    this.anim = (now) => {
      const k = Math.min(1, (now - start) / dur);
      const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      this.driftS = d0 * (1 - e); // 寄っていた視点も、元の高さに戻す
      if (zFrom !== null) this.zoom = zFrom + (1 - zFrom) * e;
      this.rotation = [from[0] + dl * e, from[1] + (to[1] - from[1]) * e];
      this.#applyProjection();
      if (k >= 1) {
        this.anim = null;
        done?.();
      }
    };
  }

  #scheduleResume() {
    clearTimeout(this.idleTimer);
    if (this.userPaused) return;
    this.idleTimer = setTimeout(() => {
      if (!this.userPaused) this.autoRotate = !reduceMotion;
      this.onRotateState?.();
    }, 5000);
  }

  #bind() {
    const c = this.canvas;
    const pointers = new Map();
    let drag = null;
    let pinch = null;
    const dist = () => {
      const [a, b] = [...pointers.values()];
      return Math.hypot(a.x - b.x, a.y - b.y);
    };
    c.addEventListener('pointerdown', (e) => {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      c.setPointerCapture(e.pointerId);
      this.autoRotate = false;
      this.anim = null;
      this.onRotateState?.(); // 触っている間は「回す」ボタンに変える（押せばすぐ回り出す）
      if (pointers.size === 2) {
        pinch = { d: dist(), zoom: this.zoom };
        drag = null;
      } else if (pointers.size === 1) drag = { x: e.clientX, y: e.clientY, rot: [...this.rotation], moved: false };
    });
    c.addEventListener('pointermove', (e) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && pointers.size === 2) {
        this.zoom = Math.max(0.7, Math.min(3, (pinch.zoom * dist()) / pinch.d));
        this.#applyProjection();
        return;
      }
      if (!drag) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
      const k = 75 / this.projection.scale();
      this.rotation = [drag.rot[0] + dx * k * 1.2, Math.max(-60, Math.min(60, drag.rot[1] - dy * k * 1.2))];
      c.classList.add('dragging');
      this.#applyProjection();
    });
    const end = (e) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      if (!drag) return this.#scheduleResume();
      c.classList.remove('dragging');
      if (!drag.moved && e.type === 'pointerup') this.#clickAt(e);
      drag = null;
      this.#scheduleResume();
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.zoom = Math.max(0.7, Math.min(3, this.zoom * (e.deltaY > 0 ? 0.92 : 1.08)));
        this.#applyProjection();
      },
      { passive: false },
    );
    // 画面の向きを変えたとき、iPhone などでは resize の時点でまだ大きさが変わっていないことがある。
    // そのため、地球儀の枠そのものの大きさの変化も見て、変わったあとに描き直す（つぶれた楕円のまま残らないように）
    let pending = 0;
    const later = () => {
      if (pending) return;
      pending = requestAnimationFrame(() => {
        pending = 0;
        if (this.canvas.clientWidth !== this.w || this.canvas.clientHeight !== this.h) this.resize();
      });
    };
    window.addEventListener('resize', () => {
      this.resize();
      later();
    });
    window.addEventListener('orientationchange', later);
    if ('ResizeObserver' in window) new ResizeObserver(later).observe(this.canvas);
  }

  #clickAt(e) {
    const rect = this.canvas.getBoundingClientRect();
    const p = this.projection.invert([e.clientX - rect.left, e.clientY - rect.top]);
    if (!p || this.visibility(p[0], p[1]) === null) return;
    // 簡略化で形が重なる場所（海峡など）では、小さいほうの国を選ぶ
    const f = this.shapes.features.filter((ft) => d3.geoContains(ft, p)).sort((x, y) => d3.geoArea(x) - d3.geoArea(y))[0];
    if (f) this.onCountryClick?.(f.id);
  }

  #loop(t) {
    const dt = this.lastT ? Math.min(0.1, (t - this.lastT) / 1000) : 0;
    this.lastT = t;
    if (this.intro) {
      // 開いたときの寄り：最初はゆっくり、最後はそっと止まる（4秒弱）
      const it = this.intro;
      if (it.start === null) it.start = t;
      const k = Math.min(1, (t - it.start) / it.dur);
      const e = 1 - Math.pow(1 - k, 3);
      this.zoom = it.z0 + (1 - it.z0) * e;
      this.rotation = [it.from[0] + (it.to[0] - it.from[0]) * e, it.from[1] + (it.to[1] - it.from[1]) * e];
      this.#applyProjection();
      if (k >= 1) this.intro = null;
    } else if (this.anim) this.anim(t);
    else if (this.autoRotate) {
      // 止まっていた後は、2〜3秒かけてじわっと元の速さに戻す
      this.curSpeed += (this.speed - this.curSpeed) * Math.min(1, dt * 0.9);
      this.rotation = [this.rotation[0] + this.curSpeed * dt, this.rotation[1]];
      if (this.drift && this.zoom === 1) {
        this.driftT += dt;
        const target = (1 - Math.cos((2 * Math.PI * this.driftT) / 120)) / 2;
        this.driftS += (target - this.driftS) * Math.min(1, dt * 0.5);
      }
      this.#applyProjection();
    }
    // 「宇宙へ」で地球儀が見えなくなっている間（skipDraw）は、描かない（もどるときに描き直す）
    if (this.skipDraw) this.dirty = true;
    else if (this.dirty) {
      this.dirty = false; // 描いている間に「次も描く」と決まったら、それを残す
      this.#draw(t);
      this.onFrame?.();
    } else if (this.dots.length || this.waves) {
      this.#draw(t); // 光点のゆらぎ・海の波
    }
    requestAnimationFrame((n) => this.#loop(n));
  }

  // 画面上で、太陽と反対の向き（夜側）。「宇宙へ」の演出でも、同じ星の濃さの向きを使う
  nightDir() {
    if (!this.sun) return [0, 0];
    const [lon, lat] = d3.geoRotation(this.rotation)(this.sun);
    const sx = Math.cos(lat * RAD) * Math.sin(lon * RAD);
    const sy = Math.sin(lat * RAD);
    return [-sx, sy]; // 画面の y は下向き
  }

  // 背景の星：夜側の方向に濃く、昼側は目をこらすと見える程度
  #drawStars(t, cx, cy) {
    const { ctx } = this;
    if (this.hideStars) return; // 「宇宙へ」の間は、星は演出の側で描く
    const [nx, ny] = this.nightDir();
    const span = Math.max(this.w, this.h) * 0.75;
    for (const s of this.stars) {
      const x = s.x * this.w;
      const y = s.y * this.h;
      const dx = (x - cx) / span;
      const dy = (y - cy) / span;
      const toward = Math.max(-1, Math.min(1, dx * nx + dy * ny)); // 夜側ほど +1
      const f = Math.pow((toward + 1) / 2, 1.5);
      const tw = reduceMotion ? 1 : 0.85 + 0.15 * Math.sin(t / 1600 + s.p);
      // 夜側ははっきり明るく、昼側は「よく見ると分かる」程度に控えめに
      const a = s.b * (0.1 + 1.15 * f) * tw;
      if (a < 0.035) continue;
      const rr = s.r * (0.85 + 0.35 * f); // 夜側の星は、ほんの少し大きく
      if (s.big || (s.mid && f > 0.6)) {
        // 明るい星は、ふんわりした光の輪をつける
        ctx.fillStyle = `rgba(200, 215, 255, ${(a * (s.big ? 0.22 : 0.12)).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(x, y, rr * 2.8, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = `rgba(${s.c || '228, 236, 255'}, ${Math.min(1, a).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(x, y, rr, 0, Math.PI * 2);
      ctx.fill();
    }
    // 流れ星：数十秒に一度だけ、地球儀の外の空を、細い光がすっと横切る（1秒ほど。点滅はしない）。
    // 「動きを減らす」設定のときは出さない
    if (reduceMotion) return;
    if (!this.meteor || t > this.meteor.end + this.meteor.wait) {
      const r0 = () => Math.random();
      const fromLeft = r0() < 0.5;
      this.meteor = {
        start: t + 0,
        end: t + 1100,
        wait: 25000 + r0() * 35000,
        x: fromLeft ? 0.05 + r0() * 0.4 : 0.55 + r0() * 0.4,
        y: 0.05 + r0() * 0.3,
        dx: (fromLeft ? 1 : -1) * (0.18 + r0() * 0.1),
        dy: 0.08 + r0() * 0.06,
      };
      if (!this.meteorSeen) {
        // ページを開いてすぐには出さない（最初の1つは、しばらく待ってから）
        this.meteorSeen = true;
        this.meteor.start = this.meteor.end = t + 15000 + Math.random() * 15000;
        this.meteor.end += 1100;
      }
    }
    const m = this.meteor;
    if (t >= m.start && t <= m.end) {
      const k = (t - m.start) / (m.end - m.start);
      const fade = Math.sin(Math.PI * k); // 出るときも消えるときも、なめらかに
      const hx = (m.x + m.dx * k) * this.w;
      const hy = (m.y + m.dy * k) * this.h;
      const len = Math.min(this.w, this.h) * 0.12;
      const nrm = Math.hypot(m.dx * this.w, m.dy * this.h);
      const tx = hx - ((m.dx * this.w) / nrm) * len;
      const ty = hy - ((m.dy * this.h) / nrm) * len;
      const lg = ctx.createLinearGradient(tx, ty, hx, hy);
      lg.addColorStop(0, 'rgba(220, 232, 255, 0)');
      lg.addColorStop(1, `rgba(240, 246, 255, ${(0.7 * fade).toFixed(3)})`);
      ctx.strokeStyle = lg;
      ctx.lineWidth = 1.2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(hx, hy);
      ctx.stroke();
      this.dirty = true;
    }
  }

  #draw(t) {
    const { ctx, path, projection } = this;
    const [cx, cy] = projection.translate();
    const r = projection.scale();
    ctx.clearRect(0, 0, this.w, this.h);
    this.#drawStars(t, cx, cy);
    // 大気のにじみ
    const halo = ctx.createRadialGradient(cx, cy, r * 0.96, cx, cy, r * 1.22);
    halo.addColorStop(0, 'rgba(120, 160, 210, 0.16)');
    halo.addColorStop(1, 'rgba(120, 160, 210, 0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 1.22, 0, Math.PI * 2);
    ctx.fill();
    // 灯の色の、ごく淡い光のふち（見る負担にならない濃さ）
    const glow = ctx.createRadialGradient(cx, cy, r * 0.99, cx, cy, r * 1.09);
    glow.addColorStop(0, 'rgba(242, 194, 122, 0.10)');
    glow.addColorStop(1, 'rgba(242, 194, 122, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 1.09, 0, Math.PI * 2);
    ctx.fill();

    // 宇宙へ出ていくときだけ、絵柄を写真のような色合いへ少しずつ近づける（0＝いつもの地球儀、1＝写真寄り）
    const rl = this.realism || 0;
    // 海
    const sea = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.1, cx, cy, r);
    sea.addColorStop(0, mixHex('#16243a', '#1d5591', rl));
    sea.addColorStop(0.6, mixHex('#122033', '#0d3466', rl));
    sea.addColorStop(1, mixHex('#0b1320', '#04142e', rl));
    ctx.fillStyle = sea;
    ctx.beginPath();
    path({ type: 'Sphere' });
    ctx.fill();
    // 海のきらめき：太陽の光が海で照り返して、見ている人の目に届く場所（太陽の真下と、画面の中心の中間）が、
    // 白っぽくやわらかく光る。太陽が地球の裏側に近いほど弱くなる。明るさは、波のようにごくゆっくり変わる（点滅はしない）。
    // 陸地は、この上から塗るので、光るのは海だけ。宇宙へ出ていくときは、照り返しを少し強くし、細かな光の粒も足す
    if (this.sun) {
      const th = d3.geoDistance(this.sun, this.center);
      const face = Math.cos(th / 2) ** 3; // 正面からの光ほど強く光る
      const sp = face > 0.15 ? projection(d3.geoInterpolate(this.center, this.sun)(0.5)) : null;
      if (sp) {
        const k = (0.9 + 0.3 * rl) * face;
        const wave = reduceMotion ? 1 : 1 + 0.08 * Math.sin(t / 5200);
        const gl = ctx.createRadialGradient(sp[0], sp[1], 0, sp[0], sp[1], r * 0.42 * wave);
        gl.addColorStop(0, `rgba(242, 249, 255, ${(0.5 * k).toFixed(3)})`);
        gl.addColorStop(0.18, `rgba(200, 228, 252, ${(0.26 * k).toFixed(3)})`);
        gl.addColorStop(0.5, `rgba(150, 200, 245, ${(0.08 * k).toFixed(3)})`);
        gl.addColorStop(1, 'rgba(120, 180, 240, 0)');
        ctx.fillStyle = gl;
        ctx.beginPath();
        path({ type: 'Sphere' });
        ctx.fill();
        if (!reduceMotion && rl > 0.3) {
          if (!this.glints) this.glints = makeGlints(26);
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          for (const g of this.glints) {
            // 光の粒は、照り返しの中で、ゆっくり明るくなったり暗くなったりする
            const x = sp[0] + Math.cos(g.a) * g.d * r * 0.2 + Math.sin(t / 9000 + g.ph) * r * 0.012;
            const y = sp[1] + Math.sin(g.a) * g.d * r * 0.15;
            const a = (0.5 + 0.5 * Math.sin(t / g.per + g.ph)) * (1 - g.d) * 0.55 * k * (rl - 0.3);
            if (a < 0.02) continue;
            const rad = Math.max(1, r * 0.008 * g.s);
            const pg = ctx.createRadialGradient(x, y, 0, x, y, rad);
            pg.addColorStop(0, `rgba(255, 252, 240, ${a.toFixed(3)})`);
            pg.addColorStop(1, 'rgba(255, 252, 240, 0)');
            ctx.fillStyle = pg;
            ctx.beginPath();
            ctx.ellipse(x, y, rad * 1.8, rad * 0.7, 0, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.restore();
        }
      }
    }
    if (rl > 0.02 && this.sun) {
      const deep = ctx.createRadialGradient(cx, cy, r * 0.5, cx, cy, r);
      deep.addColorStop(0, 'rgba(2, 10, 30, 0)');
      deep.addColorStop(1, `rgba(2, 10, 30, ${(0.35 * rl).toFixed(3)})`);
      ctx.fillStyle = deep;
      ctx.beginPath();
      path({ type: 'Sphere' });
      ctx.fill();
    }

    // 経緯線
    ctx.beginPath();
    path(this.graticule);
    ctx.strokeStyle = `rgba(170, 195, 225, ${(0.06 * (1 - rl)).toFixed(3)})`;
    ctx.lineWidth = 0.6;
    ctx.stroke();

    // 選んだ国のまわりの海の波紋：国のふちから、輪が水面の波紋のように広がり、広がるほど細く薄くなって消える。
    // 輪は地球の表面に沿った円として描く。陸地はこの上から塗るので、波紋が見えるのは海だけ。宇宙へ出ていく間は出さない
    const wv = this.waves;
    if (wv) {
      wv.a += ((wv.on && rl < 0.05 ? 1 : 0) - wv.a) * 0.035; // 1〜2秒でふわっと現れ、ふわっと消える
      if (!wv.on && wv.a < 0.01) this.waves = null;
      else {
        const RINGS = 4;
        const PERIOD = 6400; // 1つの輪が生まれてから消えるまで（ミリ秒）
        ctx.save();
        ctx.lineCap = 'round';
        for (let k = 0; k < RINGS; k++) {
          const ph = ((t - wv.t0) / PERIOD + k / RINGS) % 1;
          const grow = 1 - (1 - ph) ** 2.2; // はじめは速く、だんだんゆっくり広がる
          const rad = wv.r0 + (wv.R - wv.r0) * grow;
          const born = Math.min(1, ph / 0.1); // 生まれた瞬間は、ふわっと
          const a = wv.a * born * (1 - ph) ** 1.5 * 0.75;
          if (a < 0.01) continue;
          ctx.beginPath();
          path(d3.geoCircle().center(wv.c).radius(rad).precision(2)());
          // やわらかい光の帯と、その中の細い線を重ねて、水面の光の輪にする
          ctx.strokeStyle = `rgba(150, 200, 245, ${(a * 0.35).toFixed(3)})`;
          ctx.lineWidth = Math.min(Math.max(3, r * 0.012), 8) * (1 - 0.5 * ph);
          ctx.stroke();
          ctx.strokeStyle = `rgba(215, 236, 255, ${a.toFixed(3)})`;
          ctx.lineWidth = Math.min(Math.max(0.9, r * 0.0028), 1.8) * (1 - 0.4 * ph);
          ctx.stroke();
        }
        ctx.restore();
      }
    }

    // 陸地（写真寄りのときは、緑と土の色を、光の当たり方でゆるやかに変える）
    let landFill = '#22344a';
    if (rl > 0) {
      const lg = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.35, r * 0.05, cx, cy, r);
      lg.addColorStop(0, mixHex('#22344a', '#646d42', rl));
      lg.addColorStop(0.55, mixHex('#22344a', '#475a32', rl));
      lg.addColorStop(1, mixHex('#22344a', '#35422b', rl));
      landFill = lg;
    }
    // 写真寄りのときだけ：海岸ぞいの浅い海（大陸棚）を、明るい青緑でぼかして描く（陸地はこの上から塗る）
    if (rl > 0.02) {
      ctx.save();
      ctx.beginPath();
      path({ type: 'Sphere' });
      ctx.clip();
      if (typeof ctx.filter === 'string') ctx.filter = `blur(${Math.max(1, r * 0.01).toFixed(1)}px)`;
      ctx.strokeStyle = `rgba(70, 158, 176, ${(0.34 * rl).toFixed(3)})`;
      ctx.lineWidth = Math.max(2, r * 0.024);
      ctx.lineJoin = 'round';
      ctx.beginPath();
      for (const f of this.shapes.features) path(f);
      ctx.stroke();
      ctx.restore();
    }
    ctx.fillStyle = landFill;
    for (const f of this.shapes.features) {
      ctx.beginPath();
      path(f);
      ctx.fill();
    }

    // 写真寄りのときだけ：陸の色を気候でおおまかに塗り分ける（砂漠・森・氷）。境目はぼかす
    if (rl > 0.02) {
      ctx.save();
      ctx.beginPath();
      for (const f of this.shapes.features) path(f);
      ctx.clip();
      // 1つの地域を、中心ほど濃い円を何重にも重ねて描く（ふちがぼやけて、自然な境目になる）
      // ぼかしが使えるブラウザでは、ぼかして1回で。使えないときは、円を何重にも重ねてぼかしの代わりにする
      const canBlur = typeof ctx.filter === 'string';
      if (canBlur) ctx.filter = `blur(${Math.max(1, r * 0.03).toFixed(1)}px)`;
      const rings = canBlur ? [1] : [1, 0.88, 0.76, 0.64, 0.52, 0.4];
      for (const [lon, lat, rad, col, a] of CLIMATE) {
        ctx.fillStyle = col;
        for (const k of rings) {
          ctx.globalAlpha = (a * rl) / rings.length;
          ctx.beginPath();
          path(
            d3
              .geoCircle()
              .center([lon, lat])
              .radius(rad * (canBlur ? 0.85 : k))
              .precision(6)(),
          );
          ctx.fill();
        }
      }
      ctx.filter = 'none';
      // 地表の細かな凹凸のむら（山や谷の陰影の代わり。小さな模様を敷き詰めて重ねる）
      if (!this.landGrain) this.landGrain = makeGrain(160, 7);
      ctx.globalAlpha = 0.5 * rl;
      ctx.globalCompositeOperation = 'soft-light';
      const pat = ctx.createPattern(this.landGrain, 'repeat');
      if (pat) {
        ctx.fillStyle = pat;
        ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
      }
      // もう一段細かいむら（大きさの違う模様を重ねて、同じ模様の繰り返しに見えないようにする）
      if (!this.landGrain2) this.landGrain2 = makeGrain(96, 13);
      const pat2 = ctx.createPattern(this.landGrain2, 'repeat');
      if (pat2) {
        ctx.globalAlpha = 0.35 * rl;
        ctx.fillStyle = pat2;
        ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.restore();
    }

    // 雲：宇宙へ出ていくときだけ、写真のように少しずつ見えてくる（地球儀だけの画面には出さない）
    // 雲の形は作りもの（実際の今の雲ではない）。赤道の近くと中緯度に多く、東西に流れる形
    if (rl > 0.02) {
      if (!this.clouds) this.clouds = makeClouds();
      ctx.save();
      // 雲は球の内側だけ（大気の外へはみ出さない）
      ctx.beginPath();
      path({ type: 'Sphere' });
      ctx.clip();
      const k = r / 57.2958; // 1度あたりの画面の長さ
      if (!this.cloudSprite) this.cloudSprite = makeCloudSprite();
      const drift = (performance.now() / 1000) * 0.25; // 雲は東へ、ごくゆっくり流れる（度／秒）
      // 雲の影：太陽と反対の向きに少しずらして、濃い雲の下の海や陸をうっすら暗くする（立体感を出す）
      const [ndx, ndy] = this.nightDir ? this.nightDir() : [0, 0];
      const nl = Math.hypot(ndx, ndy) || 1;
      const shx = (ndx / nl) * r * 0.012;
      const shy = (ndy / nl) * r * 0.012;
      if (!this.cloudShadow) this.cloudShadow = makeCloudSprite(true);
      for (const c of this.clouds) {
        if (c.a < 0.22) continue;
        const lon = c.lon + drift * c.v;
        const d = d3.geoDistance([lon, c.lat], this.center);
        if (d > 1.3) continue;
        const pt = this.projection([lon, c.lat]);
        if (!pt) continue;
        ctx.globalAlpha = Math.min(0.5, c.a * 0.55 * rl * Math.cos(d));
        ctx.drawImage(this.cloudShadow, pt[0] + shx - c.rx * k, pt[1] + shy - c.ry * k, c.rx * k * 2, c.ry * k * 2);
      }
      for (const c of this.clouds) {
        const lon = c.lon + drift * c.v;
        const d = d3.geoDistance([lon, c.lat], this.center);
        if (d > 1.5) continue;
        const pt = this.projection([lon, c.lat]);
        if (!pt) continue;
        const fade = Math.cos(d); // ふちに近いほど薄く、つぶれて見える
        ctx.globalAlpha = Math.min(1, c.a * 1.15 * rl * (0.35 + 0.65 * fade));
        // ふちでは、中心へ向かう向きにつぶれる
        const toC = Math.atan2(pt[1] - cy, pt[0] - cx);
        ctx.save();
        ctx.translate(pt[0], pt[1]);
        ctx.rotate(toC);
        ctx.scale(Math.max(0.25, fade), 1);
        ctx.rotate(-toC + c.tilt);
        ctx.drawImage(this.cloudSprite, -c.rx * k, -c.ry * k, c.rx * k * 2, c.ry * k * 2);
        ctx.restore();
      }
      ctx.globalAlpha = 1;
      ctx.restore();
    }

    // 写真寄りのときだけ：太陽の向きからの光と影。太陽に近い側をわずかに明るく、遠い側とふちを暗くする（球の立体感）
    if (rl > 0.02 && this.sun) {
      const [ndx, ndy] = this.nightDir ? this.nightDir() : [0, 0];
      const nl = Math.hypot(ndx, ndy) || 1;
      const th = d3.geoDistance(this.sun, this.center);
      const off = r * Math.min(1, Math.sin(Math.min(th, Math.PI / 2)));
      const lx = cx - (ndx / nl) * off;
      const ly = cy - (ndy / nl) * off;
      ctx.save();
      ctx.beginPath();
      path({ type: 'Sphere' });
      ctx.clip();
      const sh = ctx.createRadialGradient(lx, ly, 0, lx, ly, r * 1.9);
      sh.addColorStop(0, `rgba(255, 248, 232, ${(0.1 * rl).toFixed(3)})`);
      sh.addColorStop(0.35, 'rgba(255, 248, 232, 0)');
      sh.addColorStop(0.75, 'rgba(0, 6, 20, 0)');
      sh.addColorStop(1, `rgba(0, 6, 20, ${(0.3 * rl).toFixed(3)})`);
      ctx.fillStyle = sh;
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
      // ふちの暗がり（写真の地球は、ふちほど少し暗く見える）
      const lim = ctx.createRadialGradient(cx, cy, r * 0.7, cx, cy, r);
      lim.addColorStop(0, 'rgba(0, 8, 24, 0)');
      lim.addColorStop(1, `rgba(0, 8, 24, ${(0.28 * rl).toFixed(3)})`);
      ctx.fillStyle = lim;
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
      ctx.restore();
      // 昼の側のふちだけ、大気が細く明るく光る
      const rim = ctx.createLinearGradient(cx - (ndx / nl) * r, cy - (ndy / nl) * r, cx + (ndx / nl) * r, cy + (ndy / nl) * r);
      rim.addColorStop(0, `rgba(185, 222, 255, ${(0.55 * rl).toFixed(3)})`);
      rim.addColorStop(0.55, `rgba(150, 200, 255, ${(0.12 * rl).toFixed(3)})`);
      rim.addColorStop(1, 'rgba(150, 200, 255, 0)');
      ctx.strokeStyle = rim;
      ctx.lineWidth = Math.max(1, r * 0.01);
      ctx.beginPath();
      ctx.arc(cx, cy, r - ctx.lineWidth / 2, 0, Math.PI * 2);
      ctx.stroke();
    }

    // 写真寄りのときだけ：球のふちに近いほど、大気の青いかすみがかかる
    if (rl > 0.02) {
      const hz = ctx.createRadialGradient(cx, cy, r * 0.72, cx, cy, r);
      hz.addColorStop(0, 'rgba(120, 170, 255, 0)');
      hz.addColorStop(0.78, `rgba(120, 175, 255, ${(0.1 * rl).toFixed(3)})`);
      hz.addColorStop(0.95, `rgba(140, 195, 255, ${(0.3 * rl).toFixed(3)})`);
      hz.addColorStop(1, `rgba(175, 215, 255, ${(0.46 * rl).toFixed(3)})`);
      ctx.fillStyle = hz;
      ctx.beginPath();
      path({ type: 'Sphere' });
      ctx.fill();
    }

    // 昼夜：淡い橙＝日の出・日の入り前後、暗部＝夜（国の形が読める程度の暗さにとどめる）
    if (this.night) {
      // 写真寄りのときは、昼と夜の境目をぼかす（実際の写真のように、なだらかに暗くなる）
      const soft = rl > 0.02 && typeof ctx.filter === 'string';
      if (soft) {
        ctx.save();
        ctx.beginPath();
        path({ type: 'Sphere' });
        ctx.clip();
        ctx.filter = `blur(${(r * 0.045 * rl).toFixed(1)}px)`;
      }
      ctx.fillStyle = `rgba(240, 150, 80, ${(0.1 * (1 - rl)).toFixed(3)})`;
      ctx.beginPath();
      path(this.night.golden);
      ctx.fill();
      ctx.fillStyle = `rgba(3, 7, 18, ${(0.3 + 0.55 * rl).toFixed(3)})`;
      ctx.beginPath();
      path(this.night.dark);
      ctx.fill();
      ctx.fillStyle = 'rgba(3, 7, 18, 0.14)';
      ctx.beginPath();
      path(this.night.deep);
      ctx.fill();
      if (soft) {
        ctx.filter = 'none';
        ctx.restore();
      }
      // 夜側でも陸と海の差が分かるよう、陸地をほんのり持ち上げる
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = `rgba(70, 95, 130, ${(0.1 * (1 - rl)).toFixed(3)})`;
      ctx.beginPath();
      path(this.night.dark);
      ctx.clip();
      ctx.beginPath();
      for (const f of this.shapes.features) path(f);
      ctx.fill();
      ctx.restore();
    }

    // 国境は昼夜の上に描き、夜側でも形が分かるようにする（線は細く、明るさは控えめ）
    ctx.beginPath();
    for (const f of this.shapes.features) path(f);
    ctx.strokeStyle = `rgba(175, 200, 232, ${(0.34 * (1 - 0.95 * rl)).toFixed(3)})`;
    ctx.lineWidth = 0.65;
    ctx.stroke();
    // 選んだ国：夜側でも分かるよう、いま見ている分野の色で塗り、輪郭を太く光らせる
    if (this.selectedId) {
      const sel = this.shapes.features.find((f) => f.id === this.selectedId);
      if (sel) {
        ctx.save();
        ctx.beginPath();
        path(sel);
        ctx.fillStyle = hexA(this.accent, 0.32);
        ctx.fill();
        ctx.shadowColor = hexA(this.accent, 0.8);
        ctx.shadowBlur = 8;
        ctx.strokeStyle = hexA(this.accent, 0.95);
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();
      }
    }

    // 太陽の光：太陽の側のふちに青白い大気の光、昼と夜の境目のふちに淡い夕焼け色、昼側の中ほどにやわらかな照り返し
    if (this.sun) {
      const [nx, ny] = this.nightDir();
      const len = Math.hypot(nx, ny) || 1;
      const sx = -nx / len;
      const sy = -ny / len;
      const lit = ctx.createLinearGradient(cx - sx * r, cy - sy * r, cx + sx * r, cy + sy * r);
      lit.addColorStop(0, 'rgba(255, 150, 80, 0)');
      lit.addColorStop(0.42, 'rgba(255, 150, 80, 0)');
      lit.addColorStop(0.52, 'rgba(255, 160, 90, 0.55)');
      lit.addColorStop(0.64, 'rgba(160, 205, 255, 0.70)');
      lit.addColorStop(1, 'rgba(190, 225, 255, 1)');
      // 線に見えないよう、太さと濃さを変えて何度か重ね、ぼんやりにじませる
      ctx.save();
      ctx.strokeStyle = lit;
      const boost = 1 + 1.8 * (this.sunBoost || 0);
      for (let i = 1; i <= 6; i++) {
        ctx.globalAlpha = Math.min(1, (0.085 / (1 + i * 0.35)) * boost);
        ctx.lineWidth = Math.max(1, r * 0.013 * i);
        ctx.beginPath();
        ctx.arc(cx, cy, r * (1 - 0.003 * i), 0, Math.PI * 2);
        ctx.stroke();
      }
      // 外側へ、ぼんやりにじむ光（線に見えないよう、細い線をぼかして重ねる）
      ctx.shadowColor = 'rgba(175, 210, 255, 0.55)';
      ctx.shadowBlur = Math.max(6, r * 0.07);
      ctx.globalAlpha = Math.min(1, 0.22 * boost);
      ctx.lineWidth = Math.max(1, r * 0.004);
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.997, 0, Math.PI * 2);
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.shadowColor = 'transparent';
      // 宇宙へ出ていくときだけ：地球をぐるりと包む、青い大気のふち（写真のように。少しずつ現れる）
      const rlA = this.realism || 0;
      if (rlA > 0.01) {
        ctx.shadowColor = 'rgba(110, 170, 255, 0.9)';
        ctx.shadowBlur = Math.max(6, r * 0.1);
        ctx.globalAlpha = 0.38 * rlA;
        ctx.strokeStyle = 'rgba(140, 195, 255, 0.8)';
        ctx.lineWidth = Math.max(1, r * 0.008);
        ctx.beginPath();
        ctx.arc(cx, cy, r * 1.003, 0, Math.PI * 2);
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.shadowColor = 'transparent';
      }
      ctx.globalAlpha = 1;
      // 照り返し（昼側の、太陽に近いところをごく淡く明るく）
      const hx = cx + sx * r * 0.45 * Math.min(1, len);
      const hy = cy + sy * r * 0.45 * Math.min(1, len);
      const sheen = ctx.createRadialGradient(hx, hy, 0, hx, hy, r * 0.75);
      sheen.addColorStop(0, `rgba(255, 238, 205, ${(0.1 + 0.22 * (this.sunBoost || 0)).toFixed(3)})`);
      sheen.addColorStop(1, 'rgba(255, 244, 220, 0)');
      ctx.beginPath();
      path({ type: 'Sphere' });
      ctx.clip();
      ctx.fillStyle = sheen;
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
      ctx.restore();
    }

    // 縁
    ctx.beginPath();
    path({ type: 'Sphere' });
    ctx.strokeStyle = 'rgba(170, 200, 235, 0.08)';
    ctx.lineWidth = 0.8;
    ctx.stroke();

    // 現在地の印
    if (this.here && this.visibility(this.here[0], this.here[1]) !== null) {
      const p = projection(this.here);
      ctx.strokeStyle = 'rgba(156, 198, 255, 0.9)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(p[0], p[1], 7, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = 'rgba(156, 198, 255, 0.95)';
      ctx.beginPath();
      ctx.arc(p[0], p[1], 2.5, 0, Math.PI * 2);
      ctx.fill();
      // 帰ってきたときの灯：宇宙から地球へもどったとき、現在地に、あたたかい色の灯がそっとともる（数秒でゆっくり消える）
      if (this.homeGlow) {
        const e = (performance.now() - this.homeGlow) / 1000;
        const life = e < 1.6 ? e / 1.6 : e < 6 ? 1 : Math.max(0, 1 - (e - 6) / 3);
        if (life <= 0) this.homeGlow = null;
        else {
          const swell = reduceMotion ? 1 : 1 + 0.08 * Math.sin(e * 1.3);
          const R0 = Math.max(18, r * 0.09) * swell;
          const hg = ctx.createRadialGradient(p[0], p[1], 0, p[0], p[1], R0);
          hg.addColorStop(0, `rgba(255, 236, 196, ${(0.85 * life).toFixed(3)})`);
          hg.addColorStop(0.25, `rgba(255, 200, 130, ${(0.45 * life).toFixed(3)})`);
          hg.addColorStop(1, 'rgba(242, 170, 100, 0)');
          ctx.fillStyle = hg;
          ctx.beginPath();
          ctx.arc(p[0], p[1], R0, 0, Math.PI * 2);
          ctx.fill();
          this.dirty = true;
        }
      }
    }

    // テーマでつなぐ光の弧：地表から少し浮いた弧で各地を結ぶ。
    // 1本ずつ順に、端から端へ線がのびていき、そのあとは小さな光がゆっくり弧の上を渡る（点滅はしない）。
    // 「動きを減らす」設定では、最初から全部の線を静かに表示する
    if (this.arcs.length) {
      const now = performance.now();
      const el = (now - (this.arcsStart || now)) / 1000;
      const R = projection.scale();
      const [ox, oy] = projection.translate();
      const rot = d3.geoRotation(projection.rotate());
      // 高さ alt の点を画面に写す（正射図法なので、中心からの距離を (1+alt) 倍）。地球の裏に隠れる点は null
      const lift = (ll, alt) => {
        const [lon, lat] = rot(ll);
        const lr = (lon * Math.PI) / 180;
        const pr = (lat * Math.PI) / 180;
        const vx = Math.cos(pr) * Math.sin(lr);
        const vy = -Math.sin(pr);
        const vz = Math.cos(pr) * Math.cos(lr);
        const k = 1 + alt;
        const x = ox + R * k * vx;
        const y = oy + R * k * vy;
        if (vz < 0) return null; // 裏側の部分は描かない（地平線の近くで、だんだん薄くして消す）
        return [x, y, vz];
      };
      ctx.save();
      ctx.lineCap = 'round';
      let animating = false;
      this.arcs.forEach(([a, b], i) => {
        const dist = d3.geoDistance(a, b);
        const H = Math.min(0.2, 0.05 + dist * 0.09); // 遠い2地点ほど、少し高い弧に
        const interp = d3.geoInterpolate(a, b);
        const N = 48;
        const grow = reduceMotion ? 1 : Math.max(0, Math.min(1, (el - i * 0.45) / 1.6));
        if (grow < 1) animating = true;
        if (grow <= 0) return;
        const pts = [];
        for (let j = 0; j <= N * grow; j++) {
          const t = j / N;
          pts.push(lift(interp(t), H * Math.sin(Math.PI * t)));
        }
        // 2回重ねて描く：ぼんやりした光の帯と、細い芯
        for (const [lw, rgb, a0] of [
          [4.5, '242, 194, 122', 0.13],
          [1.3, '255, 222, 170', 0.75],
        ]) {
          ctx.lineWidth = lw;
          for (let j = 1; j < pts.length; j++) {
            const q0 = pts[j - 1];
            const q1 = pts[j];
            if (!q0 || !q1) continue;
            const vis = Math.min(1, Math.min(q0[2], q1[2]) * 5); // 地平線に近いほど薄く
            if (vis <= 0.01) continue;
            ctx.strokeStyle = `rgba(${rgb}, ${(a0 * vis).toFixed(3)})`;
            ctx.beginPath();
            ctx.moveTo(q0[0], q0[1]);
            ctx.lineTo(q1[0], q1[1]);
            ctx.stroke();
          }
        }
        // 弧の上を渡る、小さな光（線がのびきったあと。1往復ではなく、端から端へゆっくり）
        if (!reduceMotion && grow >= 1) {
          animating = true;
          const per = 5 + (i % 3);
          const t = ((el - i * 0.45 - 1.6) / per + i * 0.27) % 1;
          const q = lift(interp(t), H * Math.sin(Math.PI * t));
          if (q) {
            const fade = Math.sin(Math.PI * t) * Math.min(1, q[2] * 5); // 端と地平線の近くでは消える
            const g = ctx.createRadialGradient(q[0], q[1], 0, q[0], q[1], 7);
            g.addColorStop(0, `rgba(255, 244, 220, ${(0.85 * fade).toFixed(3)})`);
            g.addColorStop(1, 'rgba(255, 220, 160, 0)');
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(q[0], q[1], 7, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      });
      ctx.restore();
      if (animating) this.dirty = true; // 動いている間は、次の画面も描く
    }

    // 光点（灯）
    const pulse = reduceMotion ? 1 : 0.85 + 0.15 * Math.sin(t / 900);
    for (const d of this.dots) {
      const v = this.visibility(d.lon, d.lat);
      if (v === null) continue;
      const p = projection([d.lon, d.lat]);
      const fade = (1 - Math.pow(v, 4)) * (1 - 0.85 * rl); // 宇宙へ出ていくと、写真の地球に見えるよう印は消えていく
      if (fade < 0.02) continue;
      const size = (d.major ? 5.5 : 3.6) * Math.min(1.4, Math.max(0.8, this.zoom)) * (this.view ? this.view.s : 1);
      const g = ctx.createRadialGradient(p[0], p[1], 0, p[0], p[1], size * 3.4 * pulse);
      g.addColorStop(0, hexA(d.color, 0.95 * fade));
      g.addColorStop(0.25, hexA(d.color, 0.55 * fade));
      g.addColorStop(1, hexA(d.color, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p[0], p[1], size * 3.4 * pulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgba(255, 248, 232, ${0.9 * fade})`;
      ctx.beginPath();
      if (d.shape === 'triangle') {
        // 警鐘（注意が必要な情報）は三角の印
        const s = size * 0.62;
        ctx.moveTo(p[0], p[1] - s);
        ctx.lineTo(p[0] + s * 0.9, p[1] + s * 0.6);
        ctx.lineTo(p[0] - s * 0.9, p[1] + s * 0.6);
        ctx.closePath();
      } else ctx.arc(p[0], p[1], size * 0.38, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

// 星の配置（毎回同じ並びになるよう、固定の種から作る）
// 背景の星：大きさと色にばらつきを持たせる（ほとんどは小さな点、ときどき明るい星。青白い星と暖かい色の星）
function makeStars(n) {
  let seed = 20261025;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  return Array.from({ length: n }, () => {
    const k = rnd();
    const big = k < 0.025;
    const mid = !big && k < 0.13;
    const tint = rnd();
    return {
      x: rnd(),
      y: rnd(),
      big,
      mid,
      r: big ? 1.5 + rnd() * 0.8 : mid ? 0.95 + rnd() * 0.4 : 0.3 + rnd() * 0.45,
      b: big ? 1 : mid ? 0.7 + rnd() * 0.3 : 0.35 + rnd() * 0.5,
      p: rnd() * 6.28,
      c: tint < 0.12 ? '255, 226, 200' : tint < 0.3 ? '200, 218, 255' : '232, 238, 255',
    };
  });
}

// 宇宙の場面だけで使う雲の形（決まった乱数で、毎回同じ形）
function makeClouds() {
  let seed = 4242;
  const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const out = [];
  const add = (lon, lat, rx, ry, tilt, a, v) => out.push({ lon, lat: Math.max(-82, Math.min(82, lat)), rx, ry, tilt, a, v });
  // 1. 赤道付近の、もくもくした雲のかたまり（熱帯）
  for (let i = 0; i < 130; i++) {
    const lon = r() * 360 - 180;
    const lat = (r() - 0.5) * 24;
    const n = 3 + Math.floor(r() * 4);
    for (let j = 0; j < n; j++) add(lon + (r() - 0.5) * 8, lat + (r() - 0.5) * 5, 1.2 + r() * 2.6, 1 + r() * 2, r() * Math.PI, 0.25 + r() * 0.35, 0.6);
  }
  // 2. 中緯度の、東西に長くのびる雲の帯
  for (let i = 0; i < 105; i++) {
    const lon = r() * 360 - 180;
    const lat = (r() < 0.5 ? 1 : -1) * (30 + r() * 34);
    const len = 4 + Math.floor(r() * 8);
    for (let j = 0; j < len; j++) add(lon + j * 3.2 + (r() - 0.5) * 2, lat + Math.sin(j * 0.5) * 2 + (r() - 0.5) * 2, 3 + r() * 4, 0.8 + r() * 1.4, (r() - 0.5) * 0.4, 0.18 + r() * 0.3, 1);
  }
  // 3. 低気圧のうず（北半球は左巻き、南半球は右巻き）
  for (let i = 0; i < 14; i++) {
    const north = r() < 0.55;
    const clon = r() * 360 - 180;
    const clat = (north ? 1 : -1) * (40 + r() * 20);
    const dir = north ? 1 : -1;
    const turn = 1.1 + r() * 0.5;
    for (let tt = 0.2; tt < Math.PI * turn; tt += 0.09) {
      const rad = 0.6 + tt * tt * 0.55;
      const ang = dir * tt + i;
      const lon = clon + (Math.cos(ang) * rad) / Math.cos((clat * Math.PI) / 180);
      const lat = clat + Math.sin(ang) * rad * 0.8;
      {
        const rr = 1.4 + r() * 1.4 + tt * 0.35;
        add(lon + (r() - 0.5) * 1.5, lat + (r() - 0.5) * 1.2, rr, rr * (0.6 + r() * 0.3), r() * Math.PI, 0.13 + 0.2 * (1 - tt / (Math.PI * turn)), 1.2);
      }
    }
  }
  // 4. うすく広がる雲（すじ雲）
  // 5. 南の海の、低気圧が次々に通る雲の帯（南緯50〜65度あたり）
  for (let i = 0; i < 60; i++) add(r() * 360 - 180, -(50 + r() * 15), 3 + r() * 5, 1 + r() * 1.6, (r() - 0.5) * 0.5, 0.16 + r() * 0.22, 1.3);
  for (let i = 0; i < 300; i++) add(r() * 360 - 180, (r() - 0.5) * 140, 2 + r() * 4, 1 + r() * 1.5, (r() - 0.5) * 0.6, 0.06 + r() * 0.08, 0.9);
  return out;
}

// 海のきらめきの光の粒（場所・大きさ・ゆらぎの速さ。1回だけ決める）
function makeGlints(n) {
  let seed = 515;
  const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  return Array.from({ length: n }, () => ({ a: r() * Math.PI * 2, d: Math.sqrt(r()) * 0.9, s: 0.6 + r() * 1.2, per: 1600 + r() * 2600, ph: r() * Math.PI * 2 }));
}

// 細かなむらの模様（明るい点と暗い点が混ざった、継ぎ目の目立たない小さな絵）
function makeGrain(S, seed0) {
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  let seed = seed0;
  const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  g.fillStyle = 'rgb(128,128,128)';
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 900; i++) {
    const x = r() * S;
    const y = r() * S;
    const rad = 1 + r() * 7;
    const v = r() < 0.5 ? 60 : 200;
    for (const [dx, dy] of [
      [0, 0],
      [S, 0],
      [-S, 0],
      [0, S],
      [0, -S],
    ]) {
      const gr = g.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, rad);
      gr.addColorStop(0, `rgba(${v},${v},${v},0.35)`);
      gr.addColorStop(1, `rgba(${v},${v},${v},0)`);
      g.fillStyle = gr;
      g.fillRect(x + dx - rad, y + dy - rad, rad * 2, rad * 2);
    }
  }
  return c;
}

// 雲1つぶんの、ふわっとした白いかたまりの絵（1回だけ作って、何度も使う）
function makeCloudSprite(shadow = false) {
  const S = 64;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  // shadow のときは、雲の影用の暗い色
  const [c0, c1, c2] = shadow ? ['0,6,16', '0,6,16', '0,6,16'] : ['255,255,255', '250,252,255', '245,248,255'];
  gr.addColorStop(0, `rgba(${c0},0.62)`);
  gr.addColorStop(0.45, `rgba(${c1},0.34)`);
  gr.addColorStop(1, `rgba(${c2},0)`);
  g.fillStyle = gr;
  g.fillRect(0, 0, S, S);
  return c;
}

// 陸の気候のおおまかな色分け（中心の経度・緯度、半径（度）、色、濃さ）。写真寄りの絵柄のときだけ使う。
// 実際の衛星写真の色合いを、ごく大まかにまねたもの（正確な植生図ではない）
const DESERT = '#cdb383';
const DRY = '#b39a6e';
const SAVANNA = '#8f8550';
const STEPPE = '#9c9468';
const HIGHLAND = '#7d6f55';
const MOUNTAIN = '#6a5c48';
const FOREST = '#2e5329';
const BOREAL = '#3f4f36';
const TUNDRA = '#8c8a72';
const ICE = '#f1f4f6';
const CLIMATE = [
  [-8, 23, 9, DESERT, 0.9],
  [2, 25, 10, DESERT, 0.9],
  [12, 24, 10, DESERT, 0.9],
  [22, 23, 9, DESERT, 0.9],
  [30, 24, 7, DESERT, 0.85],
  [45, 23, 8, DESERT, 0.85],
  [52, 20, 6, DESERT, 0.8],
  [58, 31, 5, DRY, 0.7],
  [71, 27, 4, DRY, 0.6],
  [83, 39, 5, DRY, 0.75],
  [103, 43, 6, DRY, 0.7],
  [125, -25, 9, '#c4955f', 0.8],
  [135, -26, 9, '#c4955f', 0.8],
  [143, -28, 5, DRY, 0.6],
  [20, -24, 6, DRY, 0.6],
  [15, -23, 3, DESERT, 0.6],
  [-112, 34, 5, DRY, 0.6],
  [-106, 30, 4, DRY, 0.5],
  [-69, -44, 5, DRY, 0.5],
  [-69, -24, 3, DRY, 0.6],
  [-62, -4, 12, FOREST, 0.6],
  [-55, -9, 8, FOREST, 0.5],
  [20, 0, 8, FOREST, 0.6],
  [110, 2, 8, FOREST, 0.5],
  [-100, 56, 12, BOREAL, 0.5],
  [-75, 52, 8, BOREAL, 0.45],
  [40, 60, 12, BOREAL, 0.5],
  [90, 60, 14, BOREAL, 0.5],
  [125, 60, 10, BOREAL, 0.5],
  [-110, 68, 10, TUNDRA, 0.5],
  [-80, 66, 6, TUNDRA, 0.45],
  [70, 70, 10, TUNDRA, 0.5],
  [110, 71, 10, TUNDRA, 0.5],
  [150, 68, 9, TUNDRA, 0.45],
  [20, 12, 9, SAVANNA, 0.55],
  [-2, 12, 7, SAVANNA, 0.5],
  [30, -12, 8, SAVANNA, 0.45],
  [38, 5, 5, HIGHLAND, 0.4],
  [78, 21, 7, SAVANNA, 0.4],
  [-48, -15, 7, SAVANNA, 0.45],
  [-63, -35, 6, STEPPE, 0.45],
  [-100, 45, 8, STEPPE, 0.45],
  [60, 48, 10, STEPPE, 0.55],
  [105, 45, 6, STEPPE, 0.5],
  [88, 33, 7, HIGHLAND, 0.6],
  [113, 28, 7, FOREST, 0.45],
  [102, 15, 7, FOREST, 0.5],
  [138, 37, 4, FOREST, 0.45],
  [-75, 5, 6, FOREST, 0.5],
  [20, 50, 8, FOREST, 0.3],
  [-82, 37, 7, FOREST, 0.35],
  [135, -20, 7, DRY, 0.45],
  [-70, -28, 3, MOUNTAIN, 0.5],
  [-71, -36, 3, MOUNTAIN, 0.5],
  [-72, -44, 3, MOUNTAIN, 0.5],
  [-74, -50, 3, MOUNTAIN, 0.5],
  [-76, -12, 3, MOUNTAIN, 0.5],
  [-78, -2, 3, MOUNTAIN, 0.5],
  [-75, 6, 3, MOUNTAIN, 0.5],
  [-112, 44, 3, MOUNTAIN, 0.5],
  [-116, 50, 3, MOUNTAIN, 0.5],
  [-108, 38, 3, MOUNTAIN, 0.5],
  [-122, 56, 3, MOUNTAIN, 0.5],
  [80, 32, 3, MOUNTAIN, 0.5],
  [86, 29, 3, MOUNTAIN, 0.5],
  [92, 28, 3, MOUNTAIN, 0.5],
  [72, 36, 3, MOUNTAIN, 0.5],
  [44, 40, 3, MOUNTAIN, 0.5],
  [10, 46, 3, MOUNTAIN, 0.5],
  [7, 45.5, 3, MOUNTAIN, 0.5],
  [-42, 72, 12, ICE, 0.95],
  [-40, 64, 6, ICE, 0.9],
  [-45, 78, 8, ICE, 0.95],
  ...Array.from({ length: 12 }, (_, i) => [i * 30 - 180, -80, 16, ICE, 0.95]),
];

// 2つの色（#rrggbb）を t（0〜1）で混ぜる
function mixHex(a, b, t) {
  const p = (h, i) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16);
  const c = [0, 1, 2].map((i) => Math.round(p(a, i) + (p(b, i) - p(a, i)) * Math.max(0, Math.min(1, t))));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

// 海に面していない国（波を出さない）。ISO 3166-1 alpha-3
const LANDLOCKED = new Set(
  'AFG AND ARM AUT AZE BDI BFA BLR BOL BTN BWA CAF CHE CZE ETH HUN KAZ KGZ KOS LAO LIE LSO LUX MDA MKD MLI MNG MWI NER NPL PRY RWA SMR SRB SSD SVK SWZ TCD TJK TKM UGA UZB VAT XKX ZMB ZWE'.split(' '),
);
