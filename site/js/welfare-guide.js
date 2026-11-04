// 「日本で福祉の相談先をさがす」ページ：確認済みの公式リンク（data/directory.json）から、
// 困りごと別の全国の窓口と、都道府県ごとの窓口の一覧を作る。文字はすべて textContent で入れる。
// 「ひらがなで よむ」を押すと、一覧もひらがな（＋カタカナ）で作り直す（日本語ページだけ）。
import { setupKanaSwitch } from './kana-switch.js';

const isEn = document.documentElement.lang === 'en';
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
function safeUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && !u.username && !u.password ? u.href : null;
  } catch {
    return null;
  }
}
function link(url, text) {
  const href = safeUrl(url);
  if (!href) return null;
  const a = el('a', null, text);
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  return a;
}
let kana = false;
const pick = (o) => (isEn ? o?.en || o?.ja : (kana && o?.jaKana) || o?.ja || o?.en) || '';
const kanaDate = (iso) => {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(new Date(iso));
  const v = (t) => Number(p.find((x) => x.type === t)?.value);
  return `${v('year')}ねん ${v('month')}がつ ${v('day')}にち`;
};
const fmtDate = (iso) => new Intl.DateTimeFormat(isEn ? 'en-GB' : 'ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(iso));

// 7つの地方のまとまり（表示を見やすくするためのまとまり）
const REGIONS = [
  { ja: '北海道・東北', kana: 'ほっかいどう・とうほく', en: 'Hokkaido & Tohoku', codes: ['01', '02', '03', '04', '05', '06', '07'] },
  { ja: '関東', kana: 'かんとう', en: 'Kanto', codes: ['08', '09', '10', '11', '12', '13', '14'] },
  { ja: '中部', kana: 'ちゅうぶ', en: 'Chubu', codes: ['15', '16', '17', '18', '19', '20', '21', '22', '23'] },
  { ja: '近畿', kana: 'きんき', en: 'Kinki', codes: ['24', '25', '26', '27', '28', '29', '30'] },
  { ja: '中国', kana: 'ちゅうごく', en: 'Chugoku', codes: ['31', '32', '33', '34', '35'] },
  { ja: '四国', kana: 'しこく', en: 'Shikoku', codes: ['36', '37', '38', '39'] },
  { ja: '九州・沖縄', kana: 'きゅうしゅう・おきなわ', en: 'Kyushu & Okinawa', codes: ['40', '41', '42', '43', '44', '45', '46', '47'] },
];

// 都道府県名の読み（ひらがな表示用）
const PREF_KANA = ('ほっかいどう あおもりけん いわてけん みやぎけん あきたけん やまがたけん ふくしまけん いばらきけん とちぎけん ぐんまけん ' +
  'さいたまけん ちばけん とうきょうと かながわけん にいがたけん とやまけん いしかわけん ふくいけん やまなしけん ながのけん ' +
  'ぎふけん しずおかけん あいちけん みえけん しがけん きょうとふ おおさかふ ひょうごけん ならけん わかやまけん ' +
  'とっとりけん しまねけん おかやまけん ひろしまけん やまぐちけん とくしまけん かがわけん えひめけん こうちけん ふくおかけん ' +
  'さがけん ながさきけん くまもとけん おおいたけん みやざきけん かごしまけん おきなわけん').split(' ');
const prefKana = (code) => PREF_KANA[Number(code) - 1] || '';
// ひらがな表示のときのリンクの名前（都道府県のページの題名は漢字のため、役割ごとの決まった言い方にする）
const KANA_ROLE = { main: 'くらし・しごとの そうだんの ページ', consult: 'くらし・しごとの そうだん まどぐちの あんない', mind: 'こころの けんこうの そうだん（せいしん ほけん ふくし センター など）', bousai: 'さいがい・ぼうさいの じょうほうの ページ' };

function national(dir) {
  const box = document.getElementById('national');
  box.replaceChildren();
  const links = dir.countries?.JPN?.welfare || [];
  for (const c of dir.categories || []) {
    const ls = links.filter((l) => l.cat === c.id);
    if (!ls.length) continue;
    const g = el('div', 'guide-cat');
    g.append(el('h3', null, pick(c)));
    const ul = el('ul', 'guide-links');
    for (const l of ls) {
      const a = link(l.url, pick(l.name));
      if (!a) continue;
      const li = el('li');
      li.append(a);
      if (l.desc) li.append(el('span', 'guide-desc', pick(l.desc)));
      if (l.checkedAt) li.append(el('span', 'guide-checked', isEn ? `checked ${fmtDate(l.checkedAt)}` : kana ? `${kanaDate(l.checkedAt)} かくにん` : `${fmtDate(l.checkedAt)}確認`));
      // 確認から半年（183日）以上たったリンクは、そのことを示す
      if (l.checkedAt && Date.now() - Date.parse(l.checkedAt) > 183 * 86400000) li.append(el('span', 'guide-stale', isEn ? 'Checked over 6 months ago; the page may have changed' : kana ? 'かくにんから はんとし いじょう たって います' : '確認から半年以上たっています。内容が変わっている場合があります'));
      ul.append(li);
    }
    g.append(ul);
    box.append(g);
  }
  if (!box.childElementCount) box.append(el('p', 'note', isEn ? 'The list could not be shown. Please use the links in the sections below.' : kana ? 'いちらんを ひょうじ できませんでした。したの あんないを ごりよう ください。' : '一覧を表示できませんでした。下の案内をご利用ください。'));
}

// 都道府県・市区町村の窓口を、分野ごとにさがすための国の一覧（どの分野も、全国の窓口を都道府県別にさがせる公式のページ）。
// 都道府県ごとの個別のリンクは、確認できたものから順に足していく（推測で窓口を載せない）
const AREAS = [
  { ja: '暮らし・お金・仕事', kana: 'くらし・おかね・しごと', en: 'Living, money and work', ids: ['jp-w-jiritsu'] },
  { ja: 'こころの健康', kana: 'こころの けんこう', en: 'Mental health', ids: ['jp-w-seishin-center'] },
  { ja: '子ども・子育て', kana: 'こども・こそだて', en: 'Children and parenting', ids: ['jp-w-189'] },
  { ja: '障がい・発達の特性', kana: 'しょうがい・はったつの とくせい', en: 'Disability and developmental differences', ids: ['jp-w-shogai', 'jp-w-hattatsu'] },
  { ja: '高齢・介護', kana: 'こうれい・かいご', en: 'Older people and care', ids: ['jp-w-kaigo'] },
  { ja: 'DV・暴力', kana: 'DV・ぼうりょく', en: 'Domestic violence and abuse', ids: ['jp-w-dv-center', 'jp-w-seibouryoku'] },
];
function areaFinder(dir) {
  const links = new Map((dir.countries?.JPN?.welfare || []).map((l) => [l.id, l]));
  const wrap = el('div', 'guide-areas');
  wrap.append(el('h3', null, isEn ? 'Find local services by topic' : kana ? 'ぶんやべつに、ちかくの まどぐちを さがす' : '分野別に、お住まいの地域の窓口をさがす'));
  wrap.append(el('p', 'note', isEn ? 'Each link is a national page that lists or searches public services in every prefecture.' : kana ? 'どれも、ぜんこくの とどうふけんの まどぐちを さがせる くにの ページ です。' : 'どれも、全国の都道府県の窓口を一覧・検索できる国の公式ページです。'));
  const ul = el('ul', 'guide-links');
  for (const a of AREAS) {
    const shown = a.ids.map((id) => links.get(id)).filter(Boolean).map((l) => link(l.url, pick(l.name))).filter(Boolean);
    if (!shown.length) continue;
    const li = el('li');
    li.append(el('strong', 'guide-pref', isEn ? a.en : kana ? a.kana : a.ja));
    for (const x of shown) li.append(x);
    ul.append(li);
  }
  wrap.append(ul);
  wrap.append(el('p', 'note', isEn ? 'Below: links on each prefecture\'s official website (living and work, mental health centres for some prefectures, and disaster information), and consultation pages of some cities (such as prefectural capitals) and of social welfare councils (non-profit organisations with a public role in local welfare). If your city is not listed, see the welfare section of your city\'s official website. More will be added as they are checked.' : kana ? 'したは、かく とどうふけんの こうしき サイトの ページ です（くらし・しごとの そうだん、いちぶの とどうふけんの こころの けんこうの そうだんさき、さいがい・ぼうさいの じょうほう です）。けんちょうの ある しなどの こうしき サイトの そうだんの ページと、しゃかい ふくし きょうぎかいの ページも のせて います。ほかも、かくにん できた ものから ふやして いきます。' : '下は、各都道府県の公式サイトのページです（暮らし・仕事の相談、一部の都道府県のこころの健康の相談先（精神保健福祉センターなど）、災害・防災の情報）。あわせて、県庁所在地などの市区町村の公式サイトの相談ページと、社会福祉協議会（地域の福祉を進める、公共性の高い民間の団体。社会福祉法人）のページを載せています。お住まいの市区町村が無いときは、その市区町村の公式サイトの福祉の窓口をご覧ください。ほかの都道府県・分野も、確認できたものから順に追加します。'));
  return wrap;
}

function prefectures(dir) {
  const box = document.getElementById('prefectures');
  box.replaceChildren();
  box.append(areaFinder(dir));
  const byCode = new Map((dir.prefectures || []).map((p) => [p.code, p]));
  for (const r of REGIONS) {
    const d = el('details', 'guide-region');
    d.append(el('summary', null, isEn ? r.en : kana ? r.kana : r.ja));
    const ul = el('ul', 'guide-links');
    for (const code of r.codes) {
      const p = byCode.get(code);
      if (!p) continue;
      const li = el('li');
      li.append(el('strong', 'guide-pref', isEn ? p.en : kana ? prefKana(code) || p.ja : p.ja));
      // 分野を先に示す（暮らし・仕事の相談、こころの健康。ほかの分野は確認できたものから追加する）
      const area = (l) => (l.role === 'mind' ? (isEn ? 'Mental health: ' : 'こころの健康：') : l.role === 'bousai' ? (isEn ? 'Disasters and emergencies: ' : '災害・防災の情報：') : isEn ? 'Living and work: ' : '暮らし・仕事：');
      const label = (l) => (kana && !isEn ? `${prefKana(code)}の ${KANA_ROLE[l.role] || KANA_ROLE.main}` : area(l) + pick(l.title));
      const shown = (p.links || []).map((l) => link(l.url, label(l))).filter(Boolean);
      // 市区町村・社会福祉協議会の相談ページ（確認できたものから。2026-11 追加）
      const local = (p.local || [])
        .map((l) => {
          const kind = l.kind === 'shakyo' ? (isEn ? 'Social welfare council: ' : '社会福祉協議会：') : isEn ? 'City: ' : '市区町村：';
          const text = kana && !isEn ? (l.kind === 'shakyo' ? `${l.nameKana}（しゃかい ふくし きょうぎかい）の ページ` : `${l.nameKana}の くらし・ふくしの そうだんの ページ`) : kind + pick(l.title);
          return link(l.url, text);
        })
        .filter(Boolean);
      if (shown.length || local.length) {
        for (const a of shown) li.append(a);
        if (local.length) {
          const sub = el('ul', 'guide-local');
          sub.setAttribute('aria-label', isEn ? 'Cities and social welfare councils' : kana ? 'しくちょうそんと しゃかい ふくし きょうぎかい' : '市区町村と社会福祉協議会');
          for (const a of local) sub.append(el('li').appendChild(a).parentNode);
          li.append(sub);
        }
      } else li.append(el('span', 'guide-desc', isEn ? 'Being checked. Please contact the welfare office of your city, town or village, or use the nationwide services above.' : kana ? 'かくにん ちゅう です。すんで いる しくちょうそんの ふくしの まどぐち（ふくし じむしょ など）か、うえの ぜんこくの まどぐちを ごりよう ください。' : '確認中です。お住まいの市区町村の福祉の窓口（福祉事務所など）か、上の全国の窓口をご利用ください。'));
      ul.append(li);
    }
    d.append(ul);
    box.append(d);
  }
}

(async () => {
  try {
    const dir = await (await fetch('data/directory.json', { cache: 'no-cache' })).json();
    national(dir);
    prefectures(dir);
    if (!isEn)
      setupKanaSwitch((on) => {
        kana = on;
        // 開いている地方は、作り直したあとも開いたままにする
        const open = [...document.querySelectorAll('#prefectures details')].map((d) => d.open);
        national(dir);
        prefectures(dir);
        document.querySelectorAll('#prefectures details').forEach((d, i) => (d.open = !!open[i]));
      });
  } catch {
    for (const id of ['national', 'prefectures']) {
      const box = document.getElementById(id);
      if (box) box.textContent = isEn ? 'The list could not be loaded. Please try again later.' : '一覧を読み込めませんでした。時間をおいて、もう一度お試しください。';
    }
    if (!isEn) setupKanaSwitch(); // 一覧が読めなくても、ページの文の切り替えはできるようにする
  }
})();
