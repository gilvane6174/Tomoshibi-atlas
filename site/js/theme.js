// 明るい表示（ライト）と暗い表示（ダーク）の切り替え。いつもはダーク。
// ブラウザには何も保存しない。選んだ表示は、アドレスの「?look=light」でサイト内のリンクに引き継ぐ
// （閉じて開き直せば、ダークにもどる）。地球儀のトップと宇宙の画面は、いつも暗いまま（印の引き継ぎだけをする）。
// 印の名前は look。「テーマで読む」の ?theme=…（地球儀で線を結ぶ）とは別の名前にして、ほかの印には触らない。
// head で読み込む普通のスクリプト（読み込みの途中で色が切り替わって見えないように）。外部通信なし。
(function () {
  'use strict';
  const root = document.documentElement;
  // 別のサイトの中（iframe）に埋め込まれて表示されたら、中身を出さない（なりすましや、見えないボタンを重ねるいたずらを防ぐため）
  try {
    if (window.top !== window.self) root.classList.add('framed');
  } catch {
    root.classList.add('framed');
  }
  const params = new URLSearchParams(location.search);
  const isDoc = () => document.body && document.body.classList.contains('doc');
  const KEY = 'look';
  let light = params.get(KEY) === 'light';
  // トップ（地球儀）は暗いまま。説明ページだけを明るくする（body が読み込まれる前に決めるので、トップの印で判断する）
  const isTop = /(^|\/)(index\.html)?$/.test(location.pathname);
  if (light && !isTop) root.classList.add('light');

  // サイト内のリンクかどうか（同じサイトの .html か、トップ）
  function internal(a) {
    if (!a || !a.href || a.target === '_blank' || a.hasAttribute('download')) return null;
    let u;
    try {
      u = new URL(a.href, location.href);
    } catch {
      return null;
    }
    if (u.origin !== location.origin) return null;
    if (!/(\.html|\/)$/.test(u.pathname)) return null;
    return u;
  }
  // 押されたリンクに、いまの表示の印をつける（押した瞬間に書きかえるので、あとから作られたリンクにも効く）
  function carry(e) {
    const a = e.target.closest && e.target.closest('a[href]');
    const u = internal(a);
    if (!u) return;
    if (light) u.searchParams.set(KEY, 'light');
    else if (u.searchParams.has(KEY)) u.searchParams.delete(KEY);
    else return; // 印が無ければ、リンクはそのまま
    a.href = u.toString();
  }
  document.addEventListener('click', carry, true);
  document.addEventListener('auxclick', carry, true);

  function setUrl() {
    const u = new URL(location.href);
    if (light) u.searchParams.set(KEY, 'light');
    else u.searchParams.delete(KEY);
    history.replaceState(history.state, '', u.toString());
  }

  // 説明ページの上の帯に、切り替えボタンを置く
  function addButton() {
    if (!isDoc() || document.body.hasAttribute('data-no-theme')) return; // 世界遺産のページは、自然の景色の色で固定（切り替えなし）
    const top = document.querySelector('.doc-top');
    if (!top || top.querySelector('.theme-btn')) return;
    const en = (root.lang || '').startsWith('en');
    const tools = document.createElement('div');
    tools.className = 'doc-tools';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'icon-btn theme-btn';
    // 幅の狭いスマホでは短い文字（あかるく／くらく）にして、言語のボタンが切れないようにする
    const part = (cls, text) => {
      const el = document.createElement('span');
      el.className = cls;
      el.textContent = text;
      return el;
    };
    const label = () => {
      btn.textContent = '';
      if (en) {
        btn.append(part('tb-long', light ? 'Dark mode' : 'Light mode'), part('tb-short', light ? 'Dark' : 'Light'));
        btn.setAttribute('aria-label', light ? 'Dark mode' : 'Light mode');
      } else {
        const std = part('kana-std', '');
        std.append(part('tb-long', light ? '暗い表示' : '明るい表示'), part('tb-short', light ? '暗く' : '明るく'));
        const alt = part('kana-alt', '');
        alt.append(part('tb-long', light ? 'くらい ひょうじ' : 'あかるい ひょうじ'), part('tb-short', light ? 'くらく' : 'あかるく'));
        btn.append(std, alt);
        btn.setAttribute('aria-label', light ? '暗い表示（くらい ひょうじ）' : '明るい表示（あかるい ひょうじ）');
      }
      btn.setAttribute('aria-pressed', String(light));
    };
    label();
    btn.addEventListener('click', () => {
      light = !light;
      root.classList.toggle('light', light);
      setUrl();
      label();
    });
    tools.append(btn);
    // ひらがな表示（本文の切り替え）に合わせて、このボタンの文字もひらがなにする
    const box = document.querySelector('[data-kana-box]');
    if (box && !en) {
      const sync = () => btn.classList.toggle('kana-on', box.classList.contains('kana-on'));
      sync();
      new MutationObserver(sync).observe(box, { attributes: true, attributeFilter: ['class'] });
    }
    const lang = top.querySelector('.lang');
    if (lang) tools.append(lang);
    top.append(tools);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', addButton);
  else addButton();
})();
