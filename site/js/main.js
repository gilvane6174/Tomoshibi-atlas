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
import { statusModel } from './status.js';
import { refreshQuakes } from './quake-live.js';

const $ = (id) => document.getElementById(id);
const d3 = window.d3;
const PANELS = ['detail-panel', 'list-panel', 'guide-panel'];
const isNarrow = () => window.innerWidth <= 860;

// 読み込み中の表示を消す／読み込めなかったときの表示を出す
const slowTimer = setTimeout(() => {
  const s = $('loading-slow');
  if (s) s.hidden = false;
}, 12000);
function hideLoading() {
  clearTimeout(slowTimer);
  const l = $('loading');
  if (l) l.hidden = true;
}
function showLoadError() {
  hideLoading();
  const e = $('load-error');
  if (e) e.hidden = false;
}

async function start() {
  try {
    await loadLanguage(detectLanguage());
  } catch {
    // 言語ファイルが読めない場合も、何が起きたかと再読み込みの方法を伝える
    $('status-text').textContent = '読み込みに失敗しました。ページを再読み込みしてください。/ Failed to load. Please reload the page.';
    showLoadError();
    return;
  }

  let data;
  try {
    data = await loadAll();
  } catch {
    applyStatic();
    $('status-text').textContent = t('status.error');
    showLoadError();
    return;
  }

  // 最初に開く分野は「今日の動物たち」（癒しを求めている方のため。2026-11 運用者の決定）
  const DEFAULT_LAYER = 'animals';
  const state = { current: DEFAULT_LAYER, country: null, sunNote: null, kana: false };

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
      closeSheet();
    });
    $('drawer-' + l.group).append(d);
    drawerItems.set(l.id, d);
  }

  // ── 言語に依存する表示をすべて描き直す ──
  function renderChrome() {
    applyStatic();
    // メニュー内の「灯／警鐘」見出しに印を付ける（applyStatic で文字が入れ替わるため毎回付け直す）
    for (const p of document.querySelectorAll('.drawer-group')) p.prepend(groupIcon(['caution', 'calm'].find((g) => p.classList.contains(g)) || 'light'));
    document.title = lang === 'en' ? 'Tomoshibi Atlas | Outbreaks, welfare, disasters, earthquakes, crime prevention and cyber threats on a globe — Yutaka Yoshioka' : 'Tomoshibi Atlas（ともしびアトラス）｜感染症・福祉情報・防災・地震・防犯・サイバー脅威を地球儀で — Yutaka Yoshioka（吉岡有隆）';
    const aboutHref = lang === 'en' ? 'about.en.html' : 'about.html';
    for (const id of ['disclaimer-link']) $(id).href = aboutHref + '#disclaimer';
    $('operator-link').href = aboutHref;
    $('text-guide-link').href = lang === 'en' ? 'welfare-guide.en.html' : 'safety.html';
    document.querySelector('meta[name="description"]')?.setAttribute('content', t('meta.description'));
    $('drawer-about').href = aboutHref;
    $('quick-about').href = aboutHref;
    $('quick-panel').setAttribute('aria-label', t('quick.nav'));
    // トップと（スマートフォンの）メニューから、福祉の相談先とセキュリティ対策の説明ページへ直接進める
    for (const id of ['quick-welfare', 'drawer-welfare']) $(id).href = lang === 'en' ? 'welfare-guide.en.html' : 'welfare-guide.html';
    for (const id of ['quick-security', 'drawer-security']) $(id).href = lang === 'en' ? 'security-basics.en.html' : 'security-basics.html';
    for (const id of ['quick-heritage', 'drawer-heritage']) $(id).href = lang === 'en' ? 'world-heritage.en.html' : 'world-heritage.html';
    // ボタンは短い名前、正式な名前は title に
    $('quick-security').title = t('quick.security');
    $('quick-compare').title = t('quick.compare');
    $('quick-connections').title = t('quick.connections');
    for (const id of ['quick-compare', 'drawer-compare']) $(id).href = lang === 'en' ? 'compare.en.html' : 'compare.html';
    for (const id of ['quick-connections', 'drawer-connections']) $(id).href = lang === 'en' ? 'connections.en.html' : 'connections.html';
    $('welcome-x').setAttribute('aria-label', t('welcome.closeX'));
    document.querySelector('.cosmos-ja')?.setAttribute('lang', lang); // 英語版では、宇宙の文も英語
    // 宇宙・地球を切り替えるボタン：言語を変えたときも、今の状態に合った言葉に（宇宙の処理を読み込む前でも）
    if ($('btn-space')) $('btn-space').textContent = t(document.body.classList.contains('cosmic') ? 'cosmos.back' : 'cosmos.go');
    // サイトの中から地球儀へ戻るリンクには #return を付け、最初のお知らせを出さない（showWelcome の条件）
    // ロゴは、分野・国・テーマの指定を外した、いちばん最初の画面へ（言語だけは今のまま）
    $('brand-link').href = './' + location.pathname.split('/').pop() + (lang === 'en' ? '?lang=en' : '') + '#return';
    const other = lang === 'en' ? 'ja' : 'en';
    for (const id of ['btn-lang', 'drawer-lang']) {
      const a = $(id);
      a.href = urlForLang(other) + '#return';
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
    // 最終更新（サイトを組み立てた時刻）。トップが動物の分野でも、いつの情報か分かるように画面の上に出す
    const updated = data.meta.mode === 'live' && data.meta.builtAt ? t('updated.at', { date: formatDateTime(data.meta.builtAt) }) : t('updated.local');
    for (const id of ['site-updated', 'site-updated-m']) if ($(id)) $(id).textContent = updated;
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
    const name = t('layer.' + state.current);
    // 文言の決め方は status.js（取得元の一部だけ失敗したときも知らせる。scripts/test.mjs で検査）
    const s = statusModel({ layer: name, doc: data.layers[state.current], meta: data.meta.layers[state.current], mode: data.meta.mode });
    let text;
    if (s.key === 'status.notFetchedShort') text = `${name}: ${t('status.notFetched')}`;
    else if (s.key === 'status.fetchFailedShort') text = `${name}: ${t('status.fetchFailed')}`;
    else if (s.key === 'status.preparingShort') text = `${name}: ${t('status.preparing')}`;
    else {
      const p = s.params;
      text = t(s.key, {
        ...p,
        date: p.date ? (s.key === 'status.curated' ? formatDate(p.date) : formatDateTime(p.date)) : '',
        reviewed: p.reviewed ? formatDate(p.reviewed) : '',
      });
    }
    for (const n of s.notes)
      text +=
        ' ' +
        (n.key === 'status.feedsMissing'
          ? t(n.key, { sources: n.sources.map((k) => t('feed.' + k)).join(lang === 'ja' ? '・' : ', ') })
          : t(n.key));
    if (state.current === 'quake' && quakeLiveFailed) text += ' ' + t('status.liveFailed');
    $('status-text').textContent = text;
  }

  // 共有用のURL：?country=JPN&layer=care（国と分野だけ。個人に関わる情報は入れない）
  function syncUrl() {
    try {
      const u = new URL(location.href);
      u.searchParams.delete('country');
      u.searchParams.delete('layer');
      u.searchParams.delete('list');
      if (state.country && !$('detail-panel').hidden && !state.countryFromLocate) u.searchParams.set('country', state.country);
      if (state.current !== DEFAULT_LAYER) u.searchParams.set('layer', state.current);
      history.replaceState(null, '', './' + u.pathname.split('/').pop() + u.search);
    } catch {
      /* URL を変えられない環境では何もしない */
    }
  }

  // ── 地震：分野を開いているあいだだけ、USGS の公開データをブラウザから直接読み込む（公開版だけ。10分に1回まで） ──
  // 失敗しても組み立て時の一覧をそのまま表示する（quake-live.js）
  let quakeAt = 0;
  let quakeBusy = false;
  let quakeLiveFailed = false; // 最新の読み込みに失敗して、組み立て時の一覧を出しているあいだ（画面下に知らせる）
  async function liveQuakes() {
    if (data.meta.mode !== 'live' || state.current !== 'quake' || quakeBusy || document.hidden || Date.now() - quakeAt < 10 * 60000) return;
    quakeBusy = true;
    quakeAt = Date.now();
    try {
      if (await refreshQuakes(data)) {
        quakeLiveFailed = false;
        renderChrome();
        if (state.current === 'quake') {
          labels.setItems(data.layers.quake.items, data.countryMap, layerById('quake'));
          refreshPanels();
        }
      }
    } catch {
      // 読み込めないときは、組み立て時の一覧のまま。古い一覧を最新と思われないよう、画面下に知らせる
      quakeLiveFailed = true;
      if (state.current === 'quake') updateStatus();
    } finally {
      quakeBusy = false;
    }
  }
  setInterval(liveQuakes, 60000);
  document.addEventListener('visibilitychange', liveQuakes);

  function setLayer(id) {
    state.current = id;
    if (id === 'quake') liveQuakes();
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
  // 国の基本情報は、はじめて国を開いたときにだけ読み込む（トップを開いただけでは読み込まない）
  let profiles = null;
  let profilesLoading = false;
  // 「テーマで読む」の線を出しているときのテーマ（線の先の国を開くと、そのテーマのその国の情報を、国の欄の上に出す）
  let arcTheme = null;
  function loadProfiles() {
    if (profiles || profilesLoading) return;
    profilesLoading = true;
    fetch('data/country-profiles.json', { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : null))
      .then((doc) => {
        profiles = doc && typeof doc === 'object' && doc.countries ? doc : { countries: {} };
        if (state.country && profiles.countries[state.country] && !$('detail-panel').hidden) {
          const body = $('detail-body');
          const top = body.scrollTop;
          renderDetail();
          body.scrollTop = top;
        }
      })
      .catch(() => {
        profiles = { countries: {} }; // 読めなくても、ほかの表示は続ける
      });
  }
  // 公式リンク集が後から読めたら、開いている国の欄を描き直す（読む位置は保つ）
  data.directoryReady?.then(() => {
    if (state.country && !$('detail-panel').hidden) {
      const body = $('detail-body');
      const top = body.scrollTop;
      renderDetail();
      body.scrollTop = top;
    }
  });
  function renderDetail() {
    const c = data.countryMap.get(state.country);
    loadProfiles();
    $('detail-title').textContent = countryName(c);
    renderCountry($('detail-body'), {
      country: c,
      layerId: state.current,
      data,
      profile: profiles?.countries?.[c.id] || null,
      themeInfo: arcTheme ? { id: arcTheme.id, title: arcTheme.title, items: arcTheme.items.filter((it) => (it.countries || []).includes(c.id)) } : null,
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
  function openCountry(id, { fly, keepRotation = false, sun = null, fromLocate = false }) {
    // 現在地から推定した国は、共有用の URL に書かない（閲覧者のおおよその場所が URL・履歴に残らないように）
    state.countryFromLocate = fromLocate;
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
  const guideOpts = () => ({
    aboutHref: lang === 'en' ? 'about.en.html' : 'about.html',
    onFindWelfare: findWelfare,
    onSpace: () => {
      hidePanel('guide-panel');
      goSpace();
    },
  });
  const toggleGuide = () => {
    if ($('guide-panel').hidden) {
      renderGuide($('guide-body'), guideOpts());
      showPanel('guide-panel');
    } else hidePanel('guide-panel');
  };
  for (const id of ['btn-guide', 'btn-purpose']) $(id).addEventListener('click', toggleGuide);
  $('guide-close').addEventListener('click', () => hidePanel('guide-panel'));

  // ── スマートフォンのメニュー ──
  // メニュー（ページの案内）と分野の切り替えは、別々の引き出しにする。どちらも開いている間は背後を操作の対象から外す
  function openDrawer(id, opener, focusEl) {
    closeDrawers(false);
    $(id).hidden = false;
    $('menu-backdrop').hidden = false;
    for (const e of document.body.children) if (e.id !== id && e.id !== 'menu-backdrop' && e.tagName !== 'SCRIPT') e.inert = true;
    $(opener).setAttribute('aria-expanded', 'true');
    (focusEl || $(id).querySelector('.close')).focus({ preventScroll: true });
    $(id).querySelector('.drawer-body').scrollTop = 0;
  }
  function closeDrawers(restore = true) {
    const open = ['menu-drawer', 'layer-sheet'].find((id) => !$(id).hidden);
    for (const e of document.body.children) e.inert = false;
    $('menu-drawer').hidden = true;
    $('layer-sheet').hidden = true;
    $('menu-backdrop').hidden = true;
    $('btn-menu').setAttribute('aria-expanded', 'false');
    $('current-layer').setAttribute('aria-expanded', 'false');
    if (restore && open && isNarrow()) $(open === 'menu-drawer' ? 'btn-menu' : 'current-layer').focus({ preventScroll: true }); // 閉じたら、開いたボタンへフォーカスを戻す
  }
  const openMenu = () => openDrawer('menu-drawer', 'btn-menu');
  const closeMenu = () => closeDrawers();
  const openSheet = () => openDrawer('layer-sheet', 'current-layer', drawerItems.get(state.current));
  const closeSheet = () => closeDrawers();
  $('btn-menu').addEventListener('click', () => ($('menu-drawer').hidden ? openMenu() : closeMenu()));
  $('current-layer').addEventListener('click', () => ($('layer-sheet').hidden ? openSheet() : closeSheet()));
  $('menu-close').addEventListener('click', closeMenu);
  $('layer-sheet-close').addEventListener('click', closeSheet);
  $('menu-backdrop').addEventListener('click', closeDrawers);
  // 「宇宙へ」の演出（地球儀の外側へ引いていき、また戻る）
  // 宇宙の演出の処理（cosmos.js）は重いので、「宇宙へ」を初めて押したときに読み込む。押さなければ読み込まない
  let cosmosLoading = null;
  const loadCosmos = () =>
    (cosmosLoading ||= import('./cosmos.js')
      .then((m) => m.setupCosmos(globe, t))
      .catch(() => {
        cosmosLoading = null; // 読み込めなかったときは、次に押したときにもう一度
        toast(t('cosmos.loadError')); // 押しても何も起きないように見えないよう、理由を出す
        return null;
      }));
  // ロゴ：一覧や詳細を開いたあとでも、押せばトップ画面（最初の状態）に戻る
  // 同じアドレスのまま（#だけ違う）だとページが読み直されないため、そのときは読み直す
  $('brand-link')?.addEventListener('click', (e) => {
    const u = new URL($('brand-link').href, location.href);
    if (u.pathname === location.pathname && u.search === location.search) {
      e.preventDefault();
      history.replaceState(null, '', u.href);
      location.reload();
    }
  });
  // 「ほっとする」の中の「宇宙へ」（トップ・メニュー）
  const goSpace = () => {
    closeDrawers(false);
    loadCosmos().then((c) => {
      if (c && !c.active) c.go();
    });
  };
  for (const id of ['quick-space', 'drawer-space']) $(id)?.addEventListener('click', goSpace);
  // 現在の時刻（秒まで表示。外部への通信はしない）
  // ふだんは閲覧している端末の時刻。国を選んでいる間は、その国の時刻（複数の時間帯がある国は首都の時刻）を表示する。
  // 国ごとの時間帯（data/geo/country-tz.json）は、国を初めて選んだときに読み込む
  let tzMap = null; // 読み込めたら { 国ID: 時間帯 }。まだ／読み込み中／失敗のときは null
  let tzLoading = false;
  const loadTz = () => {
    if (tzMap || tzLoading) return;
    tzLoading = true;
    fetch('data/geo/country-tz.json')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('tz'))))
      .then((j) => (tzMap = j && typeof j === 'object' ? j : null))
      .catch(() => {
        /* 読み込めなかったときは端末の時刻のまま。次に国を選んだときに、もう一度読み込む */
      })
      .finally(() => (tzLoading = false));
  };
  // 表示の書式は、言語と時間帯が変わったときだけ作り直す（毎秒作らない）
  const fmtCache = new Map();
  const clockFmt = (timeZone) => {
    const key = `${lang}|${timeZone || ''}`;
    if (!fmtCache.has(key))
      fmtCache.set(key, new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'ja-JP', { timeZone, year: 'numeric', month: lang === 'en' ? 'short' : 'long', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    return fmtCache.get(key);
  };
  let lastCountry = null;
  const tick = () => {
    const c = $('clock');
    if (!c || document.hidden) return; // 画面が隠れている間は書き換えない
    const cc = state.country && !$('detail-panel').hidden ? data.countryMap.get(state.country) : null;
    // 国を選び直したときに、まだ表が無ければ読み込む（失敗していたら、ここで再試行）
    if (cc && cc.id !== lastCountry) loadTz();
    lastCountry = cc ? cc.id : null;
    const z = cc && tzMap ? tzMap[cc.id] : null;
    if (z) {
      const [zone, multi] = Array.isArray(z) ? z : [z, 0];
      const name = lang === 'en' ? cc.enName : cc.ja;
      try {
        c.textContent = `${t(multi ? 'clock.countryCapital' : 'clock.country', { name })} ${clockFmt(zone).format(new Date())}`;
        return;
      } catch {
        /* 時間帯を扱えないブラウザでは、端末の時刻にもどす */
      }
    }
    c.textContent = `${t('clock.now')} ${clockFmt().format(new Date())}`;
  };
  document.addEventListener('visibilitychange', tick);
  tick();
  setInterval(tick, 1000);
  // 「ほっとする」：今日の動物たちへ切り替える（トップ・メニュー）
  for (const id of ['quick-animals', 'drawer-animals'])
    $(id).addEventListener('click', () => {
      closeDrawers(false);
      setLayer('animals');
    });
  // 「分野を切り替える・一覧で見る」（パソコン）：一覧を開く。分野の切り替えは上の分野のボタンで
  $('quick-switch').addEventListener('click', () => {
    if ($('list-panel').hidden) toggleList();
    document.querySelector('#layers-nav [aria-pressed="true"], #layers-nav button')?.focus({ preventScroll: true });
  });
  // 同時に開く入口は1つだけ（パソコン）
  for (const d of document.querySelectorAll('.quick-panel details'))
    d.addEventListener('toggle', () => {
      if (d.open) for (const o of document.querySelectorAll('.quick-panel details')) if (o !== d) o.open = false;
    });
  $('drawer-list').addEventListener('click', () => {
    closeSheet();
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
  // 切り替えの途中でもう一度押されたときは、待ってもらう（言語ファイルの読み込みが前後して、表示が混ざらないように）
  let switching = false;
  async function switchLanguage(e) {
    e.preventDefault();
    if (switching) return;
    switching = true;
    const next = lang === 'en' ? 'ja' : 'en';
    try {
      await loadLanguage(next);
    } catch {
      location.href = urlForLang(next) + '#return'; // 読み込めない場合だけページ移動で切り替える（最初のお知らせは出さない）
      return;
    } finally {
      switching = false;
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
  // ボタンの表示は「いま回っているか」に合わせる。手で動かして止まっている間は「回す」になり、押せばすぐ回り出す
  const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const isPlaying = () => !globe.userPaused && (globe.autoRotate || calm);
  function syncRotateButton() {
    const playing = isPlaying();
    $('btn-rotate').textContent = playing ? t('control.pause') : t('control.play');
    $('btn-rotate').setAttribute('aria-pressed', String(playing));
  }
  globe.onRotateState = syncRotateButton;
  $('btn-rotate').addEventListener('click', () => {
    if (isPlaying()) globe.pause(true);
    else globe.play();
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
          openCountry(id, { fly: false, keepRotation: true, sun: phase, fromLocate: true });
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
    if (!$('menu-drawer').hidden || !$('layer-sheet').hidden) return closeDrawers();
    for (const id of PANELS) if (!$(id).hidden) hidePanel(id);
  });
  window.addEventListener('resize', () => {
    if (!isNarrow()) closeMenu();
  });

  renderChrome();
  syncHeader();
  // テーマの光の弧：テーマに含まれる情報の国を、近い国どうし順に1本の線でつなぐ（国の数が多いときは12か国まで）
  async function showThemeArcs(themeId) {
    try {
      const r = await fetch('data/connections.json', { cache: 'no-cache' });
      if (!r.ok) return;
      const theme = (await r.json()).themes.find((t) => t.id === themeId);
      if (!theme) return;
      const all = Object.values(data.layers).flatMap((d) => d.items || []);
      const ids = [...new Set(theme.items.flatMap((id) => all.find((it) => it.id === id)?.countries || []))].filter((c) => data.countryMap.has(c)).slice(0, 12);
      // つなぐ順番：西の端の国から始めて、まだつないでいない国のうち、いちばん近い国へ順に（線が交差しにくく、短い弧になる）
      const rest = ids.map((c) => data.countryMap.get(c)).map((c) => [c.lon, c.lat]);
      rest.sort((a, b) => a[0] - b[0]);
      const pts = rest.length ? [rest.shift()] : [];
      while (rest.length) {
        const last = pts[pts.length - 1];
        let bi = 0;
        rest.forEach((q, i) => {
          if (d3.geoDistance(last, q) < d3.geoDistance(last, rest[bi])) bi = i;
        });
        pts.push(rest.splice(bi, 1)[0]);
      }
      const arcs = pts.slice(1).map((p, i) => [pts[i], p]);
      arcTheme = { id: theme.id, title: theme.title, items: theme.items.map((id) => all.find((it) => it.id === id)).filter(Boolean) };
      if (state.country && !$('detail-panel').hidden) renderDetail();
      // 線のまとまりの真ん中へ地球儀を向けてから、線を順に描きはじめる（国を指定して開いたときは、その国を優先）
      if (pts.length && !params.get('country')) {
        const [clon, clat] = d3.geoCentroid({ type: 'MultiPoint', coordinates: pts });
        globe.flyTo(clon, clat, () => globe.setArcs(arcs));
      } else globe.setArcs(arcs);
      const note = $('theme-note');
      if (note) {
        note.hidden = false;
        $('theme-note-text').textContent = lang === 'en' ? `Theme: ${theme.title.en} — lines only mean "same theme", not cause and effect.` : `テーマ：${theme.title.ja}（線は「同じテーマ」という意味だけで、原因と結果を示すものではありません）`;
      }
    } catch {
      /* 読み込めないときは線を出さない */
    }
  }
  // 「線を消す」：ページを読み直さずに、その場で線とお知らせを消す（最初のお知らせは出さない）。アドレスからもテーマを外す
  function clearThemeArcs(e) {
    e?.preventDefault();
    globe.setArcs([]);
    $('theme-note').hidden = true;
    arcTheme = null;
    if (state.country && !$('detail-panel').hidden) renderDetail();
    try {
      const u = new URL(location.href);
      u.searchParams.delete('theme');
      history.replaceState(null, '', u.pathname + u.search);
    } catch {
      /* アドレスを変えられない環境では、表示だけ消す */
    }
  }
  $('theme-note-close')?.addEventListener('click', clearThemeArcs);


  // 共有されたURL（?layer=…&country=…）で開いたときは、その分野・国を表示する（値は一覧にあるものだけ受け付ける）
  const params = new URLSearchParams(location.search);
  const fromSite = location.hash === '#return';
  if (fromSite)
    try {
      history.replaceState(null, '', './' + location.pathname.split('/').pop() + location.search);
    } catch {
      /* URL を変えられない環境では何もしない */
    }
  const pl = params.get('layer');
  if (pl && LAYERS.some((l) => l.id === resolveLayer(pl))) state.current = resolveLayer(pl);
  setLayer(state.current);
  const pc = params.get('country');
  // 「テーマで読む」からのリンク（?theme=…）：同じテーマの国どうしを、地球儀の上に光の弧で結ぶ（線は「同じテーマ」という意味だけ）
  const pt = params.get('theme');
  if (pt && /^[a-z0-9-]{1,60}$/.test(pt)) showThemeArcs(pt);
  if (pc && data.countryMap.has(pc)) openCountry(pc, { fly: true });
  // 「このサイトについて」などからのリンク（?layer=animals&list=1）：その分野の一覧を開いた状態で表示する
  else if (params.get('list') === '1' && $('list-panel').hidden) toggleList();
  // 地球儀が描かれてから、読み込み中の表示を消す
  requestAnimationFrame(() => requestAnimationFrame(() => {
    hideLoading();
    // 最初のお知らせは「新しく開いたとき」だけ出す（ブラウザに何も保存しない方式。2026-11-03 運用者の決定）
    //   出さない：再読み込み・戻る/進む・サイト内のページから地球儀へ戻ったとき（#return）・言語の切り替え・共有された分野や国の URL
    if (!pl && !pc && !pt && params.get('list') !== '1' && !fromSite && !['reload', 'back_forward'].includes(navType())) showWelcome();
  }));
}

// ページの開き方（navigate／reload／back_forward）。取得できないときは navigate とみなす
function navType() {
  try {
    return performance.getEntriesByType('navigation')[0]?.type || 'navigate';
  } catch {
    return 'navigate';
  }
}

// 最初のお知らせ：閉じやすさを優先（大きな「閉じる」ボタン・右上の×・Esc・外側を押す、のどれでも閉じる）。
// <dialog> の showModal を使い、開いているあいだは後ろを操作できないようにし、閉じたら元の場所へフォーカスを戻す
function showWelcome() {
  const d = document.getElementById('welcome');
  if (!d || typeof d.showModal !== 'function' || d.open) return;
  const close = () => d.open && d.close();
  // 閉じた後は、いま表示している分野のボタンへフォーカスを移す（キーボードで続けて操作できるように）
  d.addEventListener(
    'close',
    () => {
      const target = [document.getElementById('current-layer'), document.querySelector('.layers [aria-selected="true"]')].find((e) => e && e.offsetParent !== null);
      target?.focus({ preventScroll: true });
    },
    { once: true },
  );
  document.getElementById('welcome-close').addEventListener('click', close, { once: true });
  document.getElementById('welcome-x').addEventListener('click', close, { once: true });
  // 外側（背景）を押したときも閉じる。文字を選ぶ操作で閉じないよう、押した場所と離した場所の両方が外側のときだけ
  let downOutside = false;
  const outside = (e) => {
    const r = d.getBoundingClientRect();
    return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
  };
  d.addEventListener('pointerdown', (e) => (downOutside = e.target === d && outside(e)));
  d.addEventListener('pointerup', (e) => {
    if (downOutside && e.target === d && outside(e)) close();
    downOutside = false;
  });
  try {
    d.showModal();
    document.getElementById('welcome-close').focus();
  } catch {
    /* 表示できない環境では出さない（地球儀はそのまま使える） */
  }
}

// 想定外のエラーで止まったときも、利用者に「確認中です」と案内を出す
const run = () =>
  start().catch(() => {
    showLoadError();
  });
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
else run();
