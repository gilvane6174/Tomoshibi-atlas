// 選んだ結果を見せる：テーマや分野を選んだあと、変わった部分（一覧の先頭など）が画面の外にあるときは、
// そこまで画面を動かし、少しのあいだ枠をほんのり光らせて「ここが変わった」と分かるようにする。
// 光り方は1回だけ、ゆっくり消える（点滅はしない）。読み上げソフトでは、その見出しに移って読み上げる。
const reduce = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function revealResults(target, { focus = true } = {}) {
  const el = typeof target === 'string' ? document.getElementById(target) : target;
  if (!el) return;
  // 上に固定された帯（ロゴなど）の下に、見出しが来るようにする
  const top = el.getBoundingClientRect().top;
  const bar = document.querySelector('.doc-top')?.getBoundingClientRect().bottom || 0;
  const visible = top >= bar && top < window.innerHeight * 0.6;
  if (!visible) window.scrollTo({ top: window.scrollY + top - bar - 26, behavior: reduce() ? 'auto' : 'smooth' });
  el.classList.remove('just-updated');
  void el.offsetWidth; // 続けて選んだときも、もう一度光らせる
  el.classList.add('just-updated');
  if (focus) {
    if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
    el.focus({ preventScroll: true });
  }
}
