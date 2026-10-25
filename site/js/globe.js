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
    this.zoom = 1;
    this.speed = 2.4; // 度/秒（ゆっくり）
    this.autoRotate = !reduceMotion;
    this.userPaused = reduceMotion;
    this.dots = [];
    this.selectedId = null;
    this.here = null; // 現在地の印（端末内でのみ保持）
    this.stars = makeStars(620);
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
    this.baseRadius = Math.max(90, Math.min(aw, ah) * (this.w < 700 ? 0.46 : 0.43));
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

  setHere(lon, lat) {
    this.here = lon == null ? null : [lon, lat];
    this.dirty = true;
  }

  #applyProjection() {
    const r = Math.max(80, this.baseRadius * this.zoom);
    this.projection.scale(r).translate([this.cx, this.cy]).rotate(this.rotation);
    this.dirty = true;
  }

  get center() {
    return [-this.rotation[0], -this.rotation[1]];
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
    this.dirty = true;
  }

  pause(byUser = true) {
    this.autoRotate = false;
    if (byUser) this.userPaused = true;
    clearTimeout(this.idleTimer);
  }
  play() {
    this.userPaused = false;
    this.autoRotate = !reduceMotion;
  }
  reset(done) {
    this.zoom = 1;
    this.selectedId = null;
    this.flyTo(135, 18, () => {
      this.play();
      done?.();
    });
  }

  // 指定した経度・緯度を正面にして止める
  flyTo(lon, lat, done) {
    this.pause(true);
    const from = [...this.rotation];
    const to = [-lon, Math.max(-60, Math.min(60, -lat))];
    let dl = to[0] - from[0];
    dl = ((dl + 540) % 360) - 180; // 近い方向に回る
    if (reduceMotion) {
      this.rotation = [from[0] + dl, to[1]];
      this.#applyProjection();
      done?.();
      return;
    }
    const start = performance.now();
    const dur = 1300;
    this.anim = (now) => {
      const k = Math.min(1, (now - start) / dur);
      const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
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
    window.addEventListener('resize', () => this.resize());
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
    if (this.anim) this.anim(t);
    else if (this.autoRotate) {
      this.rotation = [this.rotation[0] + this.speed * dt, this.rotation[1]];
      this.#applyProjection();
    }
    if (this.dirty) {
      this.#draw(t);
      this.onFrame?.();
      this.dirty = false;
    } else if (this.dots.length) {
      this.#draw(t); // 光点のゆらぎ
    }
    requestAnimationFrame((n) => this.#loop(n));
  }

  // 背景の星：夜側の方向に濃く、昼側は目をこらすと見える程度
  #drawStars(t, cx, cy, r) {
    const { ctx } = this;
    let nx = 0;
    let ny = 0;
    if (this.sun) {
      const [lon, lat] = d3.geoRotation(this.rotation)(this.sun);
      const sx = Math.cos(lat * RAD) * Math.sin(lon * RAD);
      const sy = Math.sin(lat * RAD);
      nx = -sx; // 画面上で、太陽と反対の向き（夜側）
      ny = sy; // 画面の y は下向き
    }
    const span = Math.max(this.w, this.h) * 0.75;
    for (const s of this.stars) {
      const x = s.x * this.w;
      const y = s.y * this.h;
      const dx = (x - cx) / span;
      const dy = (y - cy) / span;
      const toward = Math.max(-1, Math.min(1, dx * nx + dy * ny)); // 夜側ほど +1
      const f = Math.pow((toward + 1) / 2, 1.3);
      const tw = reduceMotion ? 1 : 0.8 + 0.2 * Math.sin(t / 1400 + s.p);
      // 夜側ははっきり、昼側は「よく見ると分かる」程度に薄く
      const a = s.b * (0.2 + 0.8 * f) * tw;
      if (a < 0.03) continue;
      if (s.big) {
        // 明るい星は、ふんわりした光の輪をつける
        ctx.fillStyle = `rgba(200, 215, 255, ${(a * 0.22).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(x, y, s.r * 2.6, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = `rgba(228, 236, 255, ${Math.min(1, a).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(x, y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  #draw(t) {
    const { ctx, path, projection } = this;
    const [cx, cy] = projection.translate();
    const r = projection.scale();
    ctx.clearRect(0, 0, this.w, this.h);
    this.#drawStars(t, cx, cy, r);

    // 大気のにじみ
    const halo = ctx.createRadialGradient(cx, cy, r * 0.96, cx, cy, r * 1.22);
    halo.addColorStop(0, 'rgba(120, 160, 210, 0.16)');
    halo.addColorStop(1, 'rgba(120, 160, 210, 0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 1.22, 0, Math.PI * 2);
    ctx.fill();

    // 海
    const sea = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.1, cx, cy, r);
    sea.addColorStop(0, '#16243a');
    sea.addColorStop(1, '#0b1320');
    ctx.fillStyle = sea;
    ctx.beginPath();
    path({ type: 'Sphere' });
    ctx.fill();

    // 経緯線
    ctx.beginPath();
    path(this.graticule);
    ctx.strokeStyle = 'rgba(170, 195, 225, 0.06)';
    ctx.lineWidth = 0.6;
    ctx.stroke();

    // 陸地
    for (const f of this.shapes.features) {
      ctx.beginPath();
      path(f);
      ctx.fillStyle = f.id === this.selectedId ? '#36547a' : '#22344a';
      ctx.fill();
    }

    // 昼夜：淡い橙＝日の出・日の入り前後、暗部＝夜（国の形が読める程度の暗さにとどめる）
    if (this.night) {
      ctx.fillStyle = 'rgba(240, 150, 80, 0.10)';
      ctx.beginPath();
      path(this.night.golden);
      ctx.fill();
      ctx.fillStyle = 'rgba(3, 7, 18, 0.30)';
      ctx.beginPath();
      path(this.night.dark);
      ctx.fill();
      ctx.fillStyle = 'rgba(3, 7, 18, 0.14)';
      ctx.beginPath();
      path(this.night.deep);
      ctx.fill();
      // 夜側でも陸と海の差が分かるよう、陸地をほんのり持ち上げる
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = 'rgba(70, 95, 130, 0.10)';
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
    ctx.strokeStyle = 'rgba(175, 200, 232, 0.34)';
    ctx.lineWidth = 0.65;
    ctx.stroke();
    if (this.selectedId) {
      const sel = this.shapes.features.find((f) => f.id === this.selectedId);
      if (sel) {
        ctx.beginPath();
        path(sel);
        ctx.strokeStyle = 'rgba(242, 194, 122, 0.75)';
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
    }

    // 縁
    ctx.beginPath();
    path({ type: 'Sphere' });
    ctx.strokeStyle = 'rgba(170, 200, 235, 0.22)';
    ctx.lineWidth = 1;
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
    }

    // 光点（灯）
    const pulse = reduceMotion ? 1 : 0.85 + 0.15 * Math.sin(t / 900);
    for (const d of this.dots) {
      const v = this.visibility(d.lon, d.lat);
      if (v === null) continue;
      const p = projection([d.lon, d.lat]);
      const fade = 1 - Math.pow(v, 4);
      const size = (d.major ? 5.5 : 3.6) * Math.min(1.4, Math.max(0.8, this.zoom));
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
function makeStars(n) {
  let seed = 20261025;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  return Array.from({ length: n }, () => {
    const big = rnd() < 0.07;
    return { x: rnd(), y: rnd(), big, r: big ? 1.3 : 0.55 + rnd() * 0.45, b: big ? 1 : 0.45 + rnd() * 0.5, p: rnd() * 6.28 };
  });
}

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
