// 画面全体の組み立て。
// 言語の切り替えはページを読み直さずに行い、画面の文言・タブ・パネル・地球儀の見出しをすべて描き直す
// （プレビュー環境などでページ移動ができない場合でも確実に切り替わるように）。

import { detectLanguage, loadLanguage, t, setRich, applyStatic, urlForLang, lang } from './i18n.js';
import { loadAll, LAYERS, layerById, resolveLayer, formatDateTime, formatDate, countryName } from './data.js';
import { Globe, sunPhase } from './globe.js';
import { Labels } from './labels.js';
import { renderCountry, renderList, renderGuide } from './panel.js';
import { groupIcon } from './icons.js';
import { setupSearch } from './search.js';

const $ = (id) => document.getElementById(id);
const d3 = window.d3;
const PANELS = ['detail-panel', 'list-panel', 'guide-panel'];
const isNarrow = () => window.innerWidth <= 860;

async function start() {
  try {
    await loadLanguage(detectLanguage());
  } catch {
    // 言語ファイルが読めない場合も、何が起きたかと再読み込みの方法を伝える
    $('status-text').textContent = '読み込みに失敗しました。ページを再読み込みしてください。/ Failed to load. Please reload the page.';
    return;
  }

  let data;
  try {
    data = await loadAll();
  } catch {
    applyStatic();
    $('status-text').textContent = t('status.error');
    return;
  }

  const state = { current: 'outbreak', country: null, sunNote: null, kana: false };

  // ── 地球儀 ──
  // 画面下の帯（データの時点・運営・免責）の高さに合わせて、回転・初期表示ボタンを上に逃がす
  const syncStatus = () => document.documentElement.style.setProperty('--status-h', `${document.querySelector('.statusbar').getBoundingClientRect().height}px`);
  new ResizeObserver(syncStatus).observe(document.querySelector('.statusbar'));
  const syncHeader = () => document.documentElement.style.setProperty('--header-h', `${document.querySelector('.topbar').getBoundingClientRect().height}px`);
  const getInsets = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const ins = {
      top: Math.max(document.querySelector('.topbar').getBoundingClientRect().bottom, $('mobile-bar').getBoundingClientRect().bottom),
      bottom: h - document.querySelector('.statusbar').getBoundingClientRect().top + (isNarrow() ? 56 : 40),
      left: 0,
      right: 0,
    };
    for (const id of PANELS) {
      const p = $(id);
      if (p.hidden) continue;
      const r = p.getBoundingClientRect();
      if (isNarrow()) ins.bottom = Math.max(ins.bottom, h - r.top);
      else if (id === 'list-panel') ins.left = r.right + 8;
      else ins.right = Math.max(ins.right, w - r.left + 8);
    }
    return ins;
  };
  const globe = new Globe($('globe'), data.shapes, {
    onCountryClick: (id) => openCountry(id, { fly: false }),
    onFrame: () => labels.update(),
    getInsets,
  });
  const labels = new Labels($('labels'), globe, { onSelect: (id) => openCountry(id, { fly: true }) });
  const relayout = () => requestAnimationFrame(() => globe.relayout());
  // タブが1行に収まるかを判定し、収まらなければ2段にする（画面幅・言語が変わるたびに判定）
  const fitTabs = () => {
    const nav = $('layers-nav');
    document.body.classList.remove('tabs-wrap');
    if (!isNarrow() && nav.scrollWidth > nav.clientWidth + 1) document.body.classList.add('tabs-wrap');
  };
  new ResizeObserver(() => {
    syncHeader();
    relayout();
  }).observe(document.querySelector('.topbar'));
  window.addEventListener('resize', fitTabs);

  // ── 分野タブ（パソコン・タブレット）と、メニュー内の分野一覧（スマートフォン） ──
  const tabs = new Map();
  const drawerItems = new Map();
  for (const l of LAYERS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tab' + (l.group === 'caution' ? ' is-caution' : '');
    b.setAttribute('role', 'tab');
    b.style.setProperty('--dot', l.color);
    b.append(document.createElement('span'), Object.assign(document.createElement('span'), { className: 'count' }));
    b.addEventListener('click', () => setLayer(l.id));
    $('tabs-' + l.group).append(b);
    tabs.set(l.id, b);

    const d = document.createElement('button');
    d.type = 'button';
    d.className = 'drawer-layer' + (l.group === 'caution' ? ' is-caution' : '');
    d.style.setProperty('--dot', l.color);
    d.append(Object.assign(document.createElement('span'), { className: 'dl-name' }), Object.assign(document.createElement('span'), { className: 'dl-desc' }));
    d.addEventListener('click', () => {
      setLayer(l.id);
      closeMenu();
    });
    $('drawer-' + l.group).append(d);
    drawerItems.set(l.id, d);
  }

  // ── 言語に依存する表示をすべて描き直す ──
  function renderChrome() {
    applyStatic();
    // メニュー内の「灯／警鐘」見出しに印を付ける（applyStatic で文字が入れ替わるため毎回付け直す）
    for (const p of document.querySelectorAll('.drawer-group')) p.prepend(groupIcon(['caution', 'calm'].find((g) => p.classList.contains(g)) || 'light'));
    document.title = lang === 'en' ? 'Tomoshibi Atlas | Outbreaks, mental health, welfare, cyber threats, crime prevention and disasters on a globe — Yutaka Yoshioka' : 'Tomoshibi Atlas（ともしびアトラス）｜感染症・こころと福祉・サイバー脅威・防犯・防災を地球儀で — Yutaka Yoshioka（吉岡有隆）';
    const aboutHref = lang === 'en' ? 'about.en.html' : 'about.html';
    for (const id of ['disclaimer-link']) $(id).href = aboutHref + '#disclaimer';
    $('operator-link').href = aboutHref;
    document.querySelector('meta[name="description"]')?.setAttribute('content', t('meta.description'));
    $('drawer-about').href = aboutHref;
    $('brand-link').href = urlForLang(lang);
    const other = lang === 'en' ? 'ja' : 'en';
    for (const id of ['btn-lang', 'drawer-lang']) {
      const a = $(id);
      a.href = urlForLang(other);
      a.hreflang = other;
      a.lang = other;
      a.textContent = t('control.lang');
      a.setAttribute('aria-label', t('control.langLabel'));
    }
    $('layers-nav').setAttribute('aria-label', t('nav.layers'));
    $('tabs-light').setAttribute('aria-label', t('group.light'));
    $('tabs-caution').setAttribute('aria-label', t('group.caution'));
    $('tabs-calm').setAttribute('aria-label', t('group.calm'));
    for (const id of ['detail-close', 'list-close', 'guide-close', 'menu-close']) $(id).setAttribute('aria-label', t('control.close'));
    $('sample-banner').hidden = data.meta.mode === 'live';
    $('sample-banner').textContent = t(data.meta.mode === 'snapshot' ? 'status.snapshot' : 'status.offline');
    for (const l of LAYERS) {
      const doc = data.layers[l.id];
      const count = doc.status === 'preparing' ? t('status.preparing') : doc.status === 'notFetched' || doc.status === 'fetchFailed' ? '—' : String(data.meta.layers[l.id].count);
      const b = tabs.get(l.id);
      // タブは短い名前（あれば）を使い、横幅に収める
      b.children[0].textContent = t('tab.' + l.id) !== 'tab.' + l.id ? t('tab.' + l.id) : t('layer.' + l.id);
      b.title = t('layer.' + l.id);
      b.children[1].textContent = count;
      const d = drawerItems.get(l.id);
      d.children[0].textContent = lang === 'en' ? `${t('layer.' + l.id)} (${count})` : `${t('layer.' + l.id)}（${count}）`;
      d.children[1].textContent = t('short.' + l.id);
    }
    syncCurrent();
    fitTabs();
    syncRotateButton();
  }

  function syncCurrent() {
    for (const [k, b] of tabs) b.setAttribute('aria-selected', String(k === state.current));
    for (const [k, d] of drawerItems) d.setAttribute('aria-current', String(k === state.current));
    const l = layerById(state.current);
    $('current-layer').style.setProperty('--dot', l.color);
    $('current-layer-name').textContent = t('layer.' + state.current);
    setRich($('layer-caption'), 'caption.' + state.current);
    updateStatus();
  }

  function updateStatus() {
    const doc = data.layers[state.current];
    const m = data.meta.layers[state.current];
    let text;
    if (doc.status === 'notFetched') text = `${t('layer.' + state.current)}: ${t('status.notFetched')}`;
    else if (doc.status === 'fetchFailed') text = `${t('layer.' + state.current)}: ${t('status.fetchFailed')}`;
    else if (doc.status === 'preparing') text = `${t('layer.' + state.current)}: ${t('status.preparing')}`;
    else if (m.kind === 'auto' || (m.kind === 'mixed' && m.retrievedAt)) {
      text = t('status.live', { layer: t('layer.' + state.current), count: m.count, date: formatDateTime(m.retrievedAt) });
      // 公開版で自動取得が2日以上止まっている場合は、古い可能性を知らせる
      if (data.meta.mode === 'live' && m.retrievedAt && Date.now() - Date.parse(m.retrievedAt) > 48 * 3600000) text += ' ' + t('status.stale');
    }
    else if (m.kind === 'daily') text = t('status.daily', { layer: t('layer.' + state.current), count: m.count });
    else {
      text = t('status.curated', { layer: t('layer.' + state.current), count: m.count, date: formatDate(m.reviewedAt) });
      // 防犯・防災で、公開版なのに地震の自動取得ができなかったときは、そのことを知らせる
      if (m.kind === 'mixed' && data.meta.mode === 'live' && Object.values(m.feeds || {}).some((f) => ['failed', 'invalid'].includes(f.status))) text += ' ' + t('status.quakeMissing');
    }
    $('status-text').textContent = text;
  }

  // 共有用のURL：?country=JPN&layer=care（国と分野だけ。個人に関わる情報は入れない）
  function syncUrl() {
    try {
      const u = new URL(location.href);
      u.searchParams.delete('country');
      u.searchParams.delete('layer');
      u.searchParams.delete('list');
      if (state.country && !$('detail-panel').hidden) u.searchParams.set('country', state.country);
      if (state.current !== 'outbreak') u.searchParams.set('layer', state.current);
      history.replaceState(null, '', './' + u.pathname.split('/').pop() + u.search);
    } catch {
      /* URL を変えられない環境では何もしない */
    }
  }

  function setLayer(id) {
    state.current = id;
    syncCurrent();
    const tab = tabs.get(id);
    if (tab.offsetParent) tab.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    labels.setItems(data.layers[id].items, data.countryMap, layerById(id));
    refreshPanels();
    syncUrl();
  }

  // 開いているパネルを、現在の言語・分野で描き直す
  function refreshPanels() {
    if (state.country && !$('detail-panel').hidden) renderDetail();
    if (!$('list-panel').hidden) renderListPanel();
    // 閉じている一覧の見出しも、言語・分野に合わせて直しておく（画面に残る隠れた文字を古いままにしない）
    else $('list-title').textContent = t('panel.list', { layer: t('layer.' + state.current) });
    if (!$('guide-panel').hidden) renderGuide($('guide-body'), guideOpts());
  }

  // ── パネルの開閉 ──
  function showPanel(id) {
    if (isNarrow()) for (const p of PANELS) if (p !== id) hidePanel(p, false);
    if (id === 'guide-panel' && !$('detail-panel').hidden) hidePanel('detail-panel', false);
    if (id === 'detail-panel' && !$('guide-panel').hidden) hidePanel('guide-panel', false);
    $(id).hidden = false;
    if (id === 'list-panel') {
      document.body.classList.add('list-open');
      $('btn-list').setAttribute('aria-expanded', 'true');
    }
    if (id === 'guide-panel') $('btn-guide').setAttribute('aria-expanded', 'true');
    $(id).querySelector('.panel-body').scrollTop = 0;
    relayout();
  }
  function hidePanel(id, layout = true) {
    if (id === 'detail-panel') queueMicrotask(syncUrl);
    $(id).hidden = true;
    if (id === 'detail-panel') {
      state.country = null;
      state.sunNote = null;
      globe.setSelected(null);
    }
    if (id === 'list-panel') {
      document.body.classList.remove('list-open');
      $('btn-list').setAttribute('aria-expanded', 'false');
    }
    if (id === 'guide-panel') $('btn-guide').setAttribute('aria-expanded', 'false');
    if (layout) relayout();
  }

  // ── 国の詳細 ──
  function renderDetail() {
    const c = data.countryMap.get(state.country);
    $('detail-title').textContent = countryName(c);
    renderCountry($('detail-body'), {
      country: c,
      layerId: state.current,
      data,
      kana: state.kana,
      onSwitchLayer: (lid) => setLayer(lid),
      onToggleKana: () => {
        // 表示を切り替えても、読んでいた位置とボタンのフォーカスを保つ
        const body = $('detail-body');
        const top = body.scrollTop;
        state.kana = !state.kana;
        renderDetail();
        body.scrollTop = top;
        body.querySelector('.kana-toggle')?.focus({ preventScroll: true });
      },
    });
    if (state.sunNote) {
      const p = document.createElement('p');
      p.className = 'note sun-note';
      p.textContent = lang === 'en' ? `${t('sun.' + state.sunNote)} (${t('sun.note')})` : `${t('sun.' + state.sunNote)}（${t('sun.note')}）`;
      $('detail-body').prepend(p);
    }
  }
  function openCountry(id, { fly, keepRotation = false, sun = null }) {
    const c = data.countryMap.get(id);
    if (!c) return;
    state.country = id;
    state.sunNote = sun;
    globe.setSelected(id);
    if (fly) globe.flyTo(c.lon, c.lat);
    else if (!keepRotation) globe.pause(true);
    syncRotateButton();
    renderDetail();
    showPanel('detail-panel');
    syncUrl();
  }
  $('detail-close').addEventListener('click', () => hidePanel('detail-panel'));

  // ── 一覧 ──
  function renderListPanel() {
    $('list-title').textContent = t('panel.list', { layer: t('layer.' + state.current) });
    renderList($('list-body'), { layerId: state.current, data, onPick: (id) => openCountry(id, { fly: true }) });
  }
  const toggleList = () => {
    if ($('list-panel').hidden) {
      renderListPanel();
      showPanel('list-panel');
    } else hidePanel('list-panel');
  };
  $('btn-list').addEventListener('click', toggleList);
  // 「一覧へ移動」のスキップリンク：一覧を開いてからフォーカスを移す
  document.querySelector('.skip')?.addEventListener('click', (e) => {
    e.preventDefault();
    if ($('list-panel').hidden) toggleList();
    $('list-close').focus();
  });
  $('list-close').addEventListener('click', () => hidePanel('list-panel'));

  // ── 目的と使い方 ──
  // 「福祉一覧とセキュリティ対策など」の「福祉のタブで自分の国を探す」：福祉に切り替えて、検索欄にすぐ入力できるようにする
  const findWelfare = () => {
    hidePanel('guide-panel');
    setLayer('care');
    toast(t('add.findHint'));
    $('search-input').focus();
  };
  const guideOpts = () => ({ aboutHref: lang === 'en' ? 'about.en.html' : 'about.html', onFindWelfare: findWelfare });
  const toggleGuide = () => {
    if ($('guide-panel').hidden) {
      renderGuide($('guide-body'), guideOpts());
      showPanel('guide-panel');
    } else hidePanel('guide-panel');
  };
  for (const id of ['btn-guide', 'btn-purpose']) $(id).addEventListener('click', toggleGuide);
  $('guide-close').addEventListener('click', () => hidePanel('guide-panel'));

  // ── スマートフォンのメニュー ──
  function openMenu() {
    $('menu-drawer').hidden = false;
    $('menu-backdrop').hidden = false;
    // 開いている間は、背後の画面を操作・読み上げの対象から外す（フォーカスがメニューの外へ出ないように）
    for (const e of document.body.children) if (e.id !== 'menu-drawer' && e.id !== 'menu-backdrop' && e.tagName !== 'SCRIPT') e.inert = true;
    $('btn-menu').setAttribute('aria-expanded', 'true');
    $('current-layer').setAttribute('aria-expanded', 'true');
    (drawerItems.get(state.current) || $('menu-close')).focus();
  }
  function closeMenu() {
    const wasOpen = !$('menu-drawer').hidden;
    for (const e of document.body.children) e.inert = false;
    $('menu-drawer').hidden = true;
    if (wasOpen && isNarrow()) $('btn-menu').focus({ preventScroll: true }); // 閉じたら、開いたボタンへフォーカスを戻す
    $('menu-backdrop').hidden = true;
    $('btn-menu').setAttribute('aria-expanded', 'false');
    $('current-layer').setAttribute('aria-expanded', 'false');
  }
  for (const id of ['btn-menu', 'current-layer']) $(id).addEventListener('click', () => ($('menu-drawer').hidden ? openMenu() : closeMenu()));
  $('menu-close').addEventListener('click', closeMenu);
  $('menu-backdrop').addEventListener('click', closeMenu);
  $('drawer-list').addEventListener('click', () => {
    closeMenu();
    toggleList();
  });
  $('drawer-guide').addEventListener('click', () => {
    closeMenu();
    toggleGuide();
  });
  $('drawer-locate').addEventListener('click', () => {
    closeMenu();
    locate();
  });

  // ── 言語の切り替え（ページを読み直さない） ──
  async function switchLanguage(e) {
    e.preventDefault();
    const next = lang === 'en' ? 'ja' : 'en';
    try {
      await loadLanguage(next);
    } catch {
      location.href = urlForLang(next); // 読み込めない場合だけページ移動で切り替える
      return;
    }
    try {
      history.replaceState(null, '', urlForLang(next));
    } catch {
      /* プレビュー環境などで URL を変えられない場合は、表示だけ切り替える */
    }
    closeMenu();
    renderChrome();
    labels.setItems(data.layers[state.current].items, data.countryMap, layerById(state.current));
    refreshPanels();
    $('search-input').value = '';
  }
  $('btn-lang').addEventListener('click', switchLanguage);
  $('drawer-lang').addEventListener('click', switchLanguage);

  // ── 回転操作 ──
  function syncRotateButton() {
    const playing = !globe.userPaused;
    $('btn-rotate').textContent = playing ? t('control.pause') : t('control.play');
    $('btn-rotate').setAttribute('aria-pressed', String(playing));
  }
  $('btn-rotate').addEventListener('click', () => {
    if (globe.userPaused) globe.play();
    else globe.pause(true);
    syncRotateButton();
  });
  $('btn-reset').addEventListener('click', () => {
    hidePanel('detail-panel');
    globe.setHere(null);
    globe.reset(() => syncRotateButton());
  });

  // ── 通知 ──
  let toastTimer;
  const toast = (msg) => {
    $('toast').textContent = msg;
    $('toast').hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => ($('toast').hidden = true), 6000);
  };

  // ── 現在地：端末内だけで使い、送信・保存しない ──
  // 点から、各国の形（外周）までのいちばん近い距離（km）を求め、maxKm 以内なら国コードを返す。
  // 近い範囲だけを見るので、経度方向は緯度に応じて縮めた平面で近似する
  function nearestShape(lon, lat, maxKm) {
    const kx = 111.32 * Math.cos((lat * Math.PI) / 180);
    const ky = 110.57;
    let best = null;
    for (const f of data.shapes.features) {
      const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
      for (const poly of polys) {
        const ring = poly[0];
        for (let i = 0; i < ring.length - 1; i++) {
          let [x1, y1] = ring[i];
          let [x2, y2] = ring[i + 1];
          if (Math.abs(x2 - x1) > 180) continue; // 日付変更線をまたぐ辺は飛ばす
          if (Math.abs(y1 - lat) > 2 && Math.abs(y2 - lat) > 2) continue;
          x1 = (x1 - lon) * kx; x2 = (x2 - lon) * kx; y1 = (y1 - lat) * ky; y2 = (y2 - lat) * ky;
          const dx = x2 - x1, dy = y2 - y1;
          const len2 = dx * dx + dy * dy;
          const t = len2 ? Math.max(0, Math.min(1, -(x1 * dx + y1 * dy) / len2)) : 0;
          const d = Math.hypot(x1 + t * dx, y1 + t * dy);
          if (!best || d < best.d) best = { id: f.id, d };
        }
      }
    }
    return best && best.d <= maxKm ? best.id : null;
  }

  function locate() {
    if (!('geolocation' in navigator)) return toast(t('locate.unsupported'));
    toast(t('locate.working'));
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        // 精度を落とす（約10km単位に丸める）。この値は変数に置くだけで、どこにも送らない
        const lon = Math.round(pos.coords.longitude * 10) / 10;
        const lat = Math.round(pos.coords.latitude * 10) / 10;
        globe.setHere(lon, lat);
        // 形を簡略化しているため、海峡をはさむ国どうしなどで形が重なることがある。重なったときは小さいほうの国を選ぶ
        const hits = data.shapes.features.filter((ft) => d3.geoContains(ft, [lon, lat]));
        let id = hits.sort((x, y) => d3.geoArea(x) - d3.geoArea(y))[0]?.id;
        // 見つからないとき（海岸の近く・小さな島・地図の簡略化の誤差）：いちばん近い国境線・海岸線が約40km以内なら、その国と推定する
        if (!id) id = nearestShape(lon, lat, 40);
        // 地図に形を描いていないごく小さな国・地域：その国の代表点が約40km以内なら、その国と推定する
        if (!id) {
          let best = null;
          for (const c of data.countries) {
            const dd = d3.geoDistance([lon, lat], [c.lon, c.lat]) * 6371;
            if (!best || dd < best.dd) best = { c, dd };
          }
          if (best && best.dd < 40) id = best.c.id;
        }
        const phase = sunPhase(lon, lat);
        $('toast').hidden = true;
        globe.flyTo(lon, lat);
        if (id && data.countryMap.has(id)) {
          openCountry(id, { fly: false, keepRotation: true, sun: phase });
          // 位置は丸めて推定しているため、国境や島の近くでは別の国になることがある
          toast(t('locate.estimated', { country: countryName(data.countryMap.get(id)) }));
        }
        else toast(`${t('locate.outside')} ${t('sun.' + phase)}`);
        syncRotateButton();
      },
      (err) => toast(err.code === 1 ? t('locate.denied') : t('locate.failed')),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 },
    );
  }
  $('btn-locate').addEventListener('click', locate);

  // ── 検索：その国へ移動して止める ──
  setupSearch($('search-input'), $('search-results'), data.countries, (c) => openCountry(c.id, { fly: true }));

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!$('menu-drawer').hidden) return closeMenu();
    for (const id of PANELS) if (!$(id).hidden) hidePanel(id);
  });
  window.addEventListener('resize', () => {
    if (!isNarrow()) closeMenu();
  });

  renderChrome();
  syncHeader();
  // 共有されたURL（?layer=…&country=…）で開いたときは、その分野・国を表示する（値は一覧にあるものだけ受け付ける）
  const params = new URLSearchParams(location.search);
  const pl = params.get('layer');
  if (pl && LAYERS.some((l) => l.id === resolveLayer(pl))) state.current = resolveLayer(pl);
  setLayer(state.current);
  const pc = params.get('country');
  if (pc && data.countryMap.has(pc)) openCountry(pc, { fly: true });
  // 「このサイトについて」などからのリンク（?layer=animals&list=1）：その分野の一覧を開いた状態で表示する
  else if (params.get('list') === '1' && $('list-panel').hidden) toggleList();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
else start();
