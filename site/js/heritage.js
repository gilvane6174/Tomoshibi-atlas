// 世界遺産のページの景色：花びらの舞う草原。下へ進むほど、朝 → 昼 → 夕方 → 夜のはじまりへと空がうつり、
// 遠くの山なみと草原がゆっくり動く（奥ほど小さく動く）。夕暮れには、ほたるのような光がともる。
// このページだけで読み込む。外部への通信なし。画像は使わず、すべて canvas に描く。
// 「動きを減らす」設定のときは、動く演出をやめ、下へ進んだときに空の色だけを描き直す。
(function () {
  'use strict';
  const root = document.documentElement;
  root.classList.add('wh-js');
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ── 下へ進むと、ふわっと現れる ──
  const items = [...document.querySelectorAll('[data-reveal]')];
  if (reduce || !('IntersectionObserver' in window)) items.forEach((el) => el.classList.add('shown'));
  else {
    const io = new IntersectionObserver(
      (entries) => {
        for (const en of entries) {
          if (!en.isIntersecting) continue;
          en.target.classList.add('shown');
          io.unobserve(en.target);
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.06 },
    );
    items.forEach((el) => io.observe(el));
  }

  // ── 「下へ進む」：次の面へ、なめらかに移る（動きを減らす設定では、すぐに移る） ──
  const down = document.querySelector('.wh-down');
  const firstPanel = document.getElementById('wh-about');
  if (down && firstPanel) {
    down.addEventListener('click', (e) => {
      e.preventDefault();
      const top = firstPanel.getBoundingClientRect().top + window.scrollY - 80;
      window.scrollTo({ top, behavior: reduce ? 'auto' : 'smooth' });
      firstPanel.classList.add('shown');
      firstPanel.setAttribute('tabindex', '-1');
      firstPanel.focus({ preventScroll: true });
    });
  }

  // ── 国・地域の名前でしぼりこむ（ひらがな・カタカナ、全角・半角、大文字・小文字を区別しない） ──
  const input = document.getElementById('wh-filter');
  const list = document.getElementById('wh-countries');
  const count = document.getElementById('wh-count');
  if (input && list && count) {
    const en = (root.lang || '').startsWith('en');
    const norm = (s) =>
      s
        .normalize('NFKC')
        .toLowerCase()
        .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
        .replace(/[\s・･'’.-]/g, '');
    const rows = [...list.querySelectorAll('li')].map((li) => ({ li, key: norm(li.textContent || '') }));
    const show = () => {
      const q = norm(input.value || '');
      let n = 0;
      for (const r of rows) {
        const hit = !q || r.key.includes(q);
        r.li.hidden = !hit;
        if (hit) n++;
      }
      count.textContent = en ? `${n} of ${rows.length} countries and areas` : `${rows.length}の国・地域のうち、${n}を表示しています`;
    };
    input.addEventListener('input', show);
    show();
  }

  // ── 景色 ──
  const cv = document.getElementById('wh-scene');
  const ctx = cv && cv.getContext ? cv.getContext('2d') : null;
  if (!ctx) return;

  let W = 0;
  let H = 0;
  let dpr = 1;
  let seed = 7;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  // 時間帯ごとの色（上の空・下の空・遠い山・近い草原）。下へ進む割合で、となりどうしをなめらかに混ぜる
  const STOPS = [
    { top: [247, 222, 204], bot: [252, 240, 226], far: [196, 186, 196], hill: [150, 176, 120], sun: [255, 236, 200] }, // 朝
    { top: [176, 214, 238], bot: [236, 244, 232], far: [160, 186, 196], hill: [124, 168, 98], sun: [255, 250, 232] }, // 昼
    { top: [244, 206, 160], bot: [250, 232, 200], far: [196, 160, 150], hill: [146, 152, 84], sun: [255, 214, 150] }, // 夕方
    { top: [70, 74, 120], bot: [222, 164, 140], far: [104, 92, 124], hill: [64, 86, 60], sun: [255, 190, 140] }, // 日暮れ
  ];
  const mix = (a, b, k) => a.map((v, i) => Math.round(v + (b[i] - v) * k));
  const rgb = (c, a = 1) => `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})`;
  function palette(p) {
    const x = Math.min(0.999, Math.max(0, p)) * (STOPS.length - 1);
    const i = Math.floor(x);
    const k = x - i;
    const k2 = k * k * (3 - 2 * k);
    const a = STOPS[i];
    const b = STOPS[i + 1];
    const o = {};
    for (const key of Object.keys(a)) o[key] = mix(a[key], b[key], k2);
    return o;
  }

  // 山なみ（なめらかな起伏）。奥・中・手前の3つ
  let ridges = [];
  let flowers = [];
  let blades = [];
  let petals = [];
  let flies = [];
  function ridge(n, amp, base) {
    const pts = [];
    const f1 = 1 + rnd() * 2;
    const f2 = 3 + rnd() * 4;
    const o1 = rnd() * 6;
    const o2 = rnd() * 6;
    for (let i = 0; i <= n; i++) {
      const x = i / n;
      pts.push(base - amp * (0.6 * Math.sin(x * Math.PI * f1 + o1) + 0.3 * Math.sin(x * Math.PI * f2 + o2) + 0.1 * Math.sin(x * 40 + o1)));
    }
    return pts;
  }
  const PETAL_COLORS = [
    [246, 196, 210],
    [250, 214, 224],
    [255, 240, 244],
    [240, 186, 200],
    [255, 248, 236],
  ];
  const FLOWER_COLORS = [
    [236, 150, 176],
    [250, 236, 160],
    [255, 255, 250],
    [190, 160, 230],
    [246, 176, 120],
  ];
  function build() {
    seed = 7;
    ridges = [ridge(60, 0.07, 0.52), ridge(70, 0.06, 0.62), ridge(80, 0.045, 0.72)];
    const small = W < 600;
    flowers = Array.from({ length: small ? 120 : 260 }, () => {
      const d = rnd(); // 0＝奥、1＝手前
      return { x: rnd(), y: 0.74 + d * 0.26, r: 0.8 + d * 2.6, c: FLOWER_COLORS[Math.floor(rnd() * FLOWER_COLORS.length)], ph: rnd() * 6.28 };
    });
    blades = Array.from({ length: small ? 110 : 220 }, () => ({ x: rnd(), h: 0.04 + rnd() * 0.08, w: 1 + rnd() * 1.6, ph: rnd() * 6.28, sp: 0.6 + rnd() * 0.8, tone: rnd() }));
    petals = Array.from({ length: small ? 26 : 48 }, () => newPetal(true));
    flies = Array.from({ length: small ? 14 : 26 }, () => ({ x: rnd(), y: 0.62 + rnd() * 0.34, ph: rnd() * 6.28, sp: 0.3 + rnd() * 0.5 }));
  }
  function newPetal(anywhere) {
    return {
      x: anywhere ? rnd() * 1.2 - 0.1 : -0.1 - rnd() * 0.2,
      y: anywhere ? rnd() : -0.1 + rnd() * 0.5,
      s: 3 + rnd() * 5,
      vx: 0.012 + rnd() * 0.02,
      vy: 0.01 + rnd() * 0.016,
      rot: rnd() * 6.28,
      vr: (rnd() - 0.5) * 1.6,
      sw: rnd() * 6.28,
      c: PETAL_COLORS[Math.floor(rnd() * PETAL_COLORS.length)],
    };
  }

  function resize() {
    dpr = Math.min(1.5, window.devicePixelRatio || 1);
    W = window.innerWidth;
    H = window.innerHeight;
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    build();
  }

  const progress = () => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    return max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
  };

  function drawRidge(pts, color, shift) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, H);
    const n = pts.length - 1;
    for (let i = 0; i <= n; i++) ctx.lineTo((i / n) * W, pts[i] * H + shift);
    ctx.lineTo(W, H);
    ctx.closePath();
    ctx.fill();
  }

  let last = 0;
  function draw(now) {
    const t = now / 1000;
    const dt = Math.min(0.05, last ? t - last : 0.016);
    last = t;
    const p = progress();
    const pal = palette(p);
    const scroll = p * H * 0.5; // 下へ進む量（奥ほど小さく動かす）

    // 空
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, rgb(pal.top));
    sky.addColorStop(0.75, rgb(pal.bot));
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    // 太陽：下へ進むほど、ゆっくり沈む
    const sx = W * (0.78 - p * 0.18);
    const sy = H * (0.16 + p * 0.46);
    const sr = Math.min(W, H) * 0.06;
    const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, sr * 6);
    glow.addColorStop(0, rgb(pal.sun, 0.55));
    glow.addColorStop(0.25, rgb(pal.sun, 0.18));
    glow.addColorStop(1, rgb(pal.sun, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = rgb(pal.sun, 0.9);
    ctx.beginPath();
    ctx.arc(sx, sy, sr, 0, Math.PI * 2);
    ctx.fill();

    // 夜のはじまりに、星をうっすら
    if (p > 0.72) {
      const a = (p - 0.72) / 0.28;
      ctx.fillStyle = `rgba(255, 252, 240, ${(0.7 * a).toFixed(3)})`;
      for (let i = 0; i < 60; i++) {
        const x = ((i * 97.13) % 100) / 100;
        const y = ((i * 53.71) % 45) / 100;
        const tw = reduce ? 1 : 0.6 + 0.4 * Math.sin(t * 1.3 + i);
        ctx.globalAlpha = tw;
        ctx.fillRect(x * W, y * H, 1.3, 1.3);
      }
      ctx.globalAlpha = 1;
    }

    // 山なみ（奥は空の色に近く、手前ほど濃い緑）
    drawRidge(ridges[0], rgb(mix(pal.far, pal.bot, 0.35)), -scroll * 0.08);
    drawRidge(ridges[1], rgb(mix(pal.far, pal.hill, 0.45)), -scroll * 0.16);
    drawRidge(ridges[2], rgb(mix(pal.hill, pal.far, 0.15)), -scroll * 0.26);

    // 草原（いちばん手前の丘）
    const meadowTop = H * 0.76 - scroll * 0.36;
    const mg = ctx.createLinearGradient(0, meadowTop, 0, H);
    mg.addColorStop(0, rgb(mix(pal.hill, [255, 255, 255], 0.08)));
    mg.addColorStop(1, rgb(mix(pal.hill, [20, 40, 20], 0.35)));
    ctx.fillStyle = mg;
    ctx.beginPath();
    ctx.moveTo(0, H);
    ctx.lineTo(0, meadowTop + H * 0.03);
    ctx.quadraticCurveTo(W * 0.3, meadowTop - H * 0.035, W * 0.62, meadowTop + H * 0.01);
    ctx.quadraticCurveTo(W * 0.85, meadowTop + H * 0.035, W, meadowTop - H * 0.005);
    ctx.lineTo(W, H);
    ctx.closePath();
    ctx.fill();

    // 花
    for (const f of flowers) {
      const y = f.y * H - scroll * (0.3 + 0.1 * (f.y - 0.74) * 4);
      if (y < meadowTop - 4 || y > H + 4) continue;
      const sway = reduce ? 0 : Math.sin(t * 0.9 + f.ph) * f.r * 0.6;
      ctx.fillStyle = rgb(f.c, 0.9);
      ctx.beginPath();
      ctx.arc(f.x * W + sway, y, f.r, 0, Math.PI * 2);
      ctx.fill();
    }

    // 手前の草（風でゆれる）
    const grassBase = H + 2;
    for (const b of blades) {
      const x = b.x * W;
      const h = b.h * H;
      const bend = reduce ? 0 : Math.sin(t * b.sp + b.ph + b.x * 4) * h * 0.18;
      ctx.strokeStyle = rgb(mix(pal.hill, b.tone > 0.5 ? [40, 70, 30] : [190, 210, 140], 0.35), 0.85);
      ctx.lineWidth = b.w;
      ctx.beginPath();
      ctx.moveTo(x, grassBase);
      ctx.quadraticCurveTo(x + bend * 0.4, grassBase - h * 0.6, x + bend, grassBase - h);
      ctx.stroke();
    }

    // ほたるのような光（日暮れ）
    if (p > 0.6) {
      const a = Math.min(1, (p - 0.6) / 0.25);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const f of flies) {
        const fx = f.x * W + (reduce ? 0 : Math.sin(t * f.sp + f.ph) * 24);
        const fy = f.y * H + (reduce ? 0 : Math.cos(t * f.sp * 0.8 + f.ph) * 14);
        const lum = a * (reduce ? 0.6 : 0.35 + 0.65 * Math.max(0, Math.sin(t * 1.4 + f.ph)));
        const g = ctx.createRadialGradient(fx, fy, 0, fx, fy, 9);
        g.addColorStop(0, `rgba(255, 246, 170, ${(0.9 * lum).toFixed(3)})`);
        g.addColorStop(1, 'rgba(255, 246, 170, 0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(fx, fy, 9, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // 花びら（風に乗って、右下へゆっくり流れる）
    if (!reduce) {
      for (const q of petals) {
        q.sw += dt * 1.2;
        q.x += (q.vx + Math.sin(q.sw) * 0.006) * dt * 3;
        q.y += q.vy * dt * 3;
        q.rot += q.vr * dt;
        if (q.x > 1.15 || q.y > 1.08) Object.assign(q, newPetal(false));
        const px = q.x * W;
        const py = q.y * H;
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(q.rot);
        ctx.scale(1, 0.55 + 0.45 * Math.abs(Math.sin(q.sw * 1.7))); // くるくる回って見える
        ctx.fillStyle = rgb(q.c, 0.88);
        ctx.beginPath();
        ctx.moveTo(0, -q.s);
        ctx.quadraticCurveTo(q.s * 0.9, -q.s * 0.2, 0, q.s);
        ctx.quadraticCurveTo(-q.s * 0.9, -q.s * 0.2, 0, -q.s);
        ctx.fill();
        ctx.restore();
      }
    }
  }

  let raf = 0;
  const loop = (now) => {
    raf = 0;
    draw(now);
    if (!document.hidden) raf = requestAnimationFrame(loop);
  };
  resize();
  window.addEventListener('resize', () => {
    resize();
    if (reduce) draw(performance.now());
  });
  if (reduce) {
    // 動きを減らす設定：下へ進んだときだけ、空の色を描き直す
    draw(performance.now());
    window.addEventListener('scroll', () => requestAnimationFrame((n) => draw(n)), { passive: true });
  } else {
    raf = requestAnimationFrame(loop);
    // 別のタブを見ている間は止める
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && !raf) {
        last = 0;
        raf = requestAnimationFrame(loop);
      }
    });
  }
})();
