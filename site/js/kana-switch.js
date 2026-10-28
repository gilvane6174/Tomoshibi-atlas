// 「ひらがなで よむ」切り替えボタン（説明ページ・福祉の探し方ページ用）。
// ボタン（.kana-toggle[data-kana-switch]）を押すと、いちばん近い [data-kana-box]（なければページ全体）に
// kana-on を付け外しする。表示の入れ替えは CSS（.kana-std／.kana-alt）で行う。文字は textContent だけで変える。
// 切り替えたら onChange(on) を呼ぶ（動的な一覧を作り直すため）。

const ON = 'ひらがなで よむ';
const OFF = 'かんじで よむ';

export function setupKanaSwitch(onChange) {
  const buttons = [...document.querySelectorAll('[data-kana-switch]')];
  const apply = (box, on) => {
    box.classList.toggle('kana-on', on);
    for (const b of buttons) {
      if ((b.closest('[data-kana-box]') || document.body) !== box) continue;
      b.setAttribute('aria-pressed', String(on));
      b.textContent = on ? OFF : ON;
    }
  };
  for (const b of buttons) {
    b.type = 'button';
    b.hidden = false; // JavaScript が動かない環境ではボタンを出さない（HTML では hidden）
    const box = b.closest('[data-kana-box]') || document.body;
    apply(box, false);
    b.addEventListener('click', () => {
      const on = !box.classList.contains('kana-on');
      apply(box, on);
      if (onChange) onChange(on, box);
    });
  }
}
