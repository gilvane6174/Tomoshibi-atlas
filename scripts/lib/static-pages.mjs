// 組み立て時に作る、検索エンジンでも読める静的なページ（2026-11 追加）
//   - 今週のともしび（weekly.html / weekly.en.html）：この1週間に原典を確認して掲載した手動掲載の情報から5〜10件
//   - RSS（feed.xml / feed.en.xml）：新しく掲載した手動掲載の情報（公開URLが分かるときだけ作る）
//   - 都道府県別の福祉の相談先（welfare-pref.html と welfare-pref-01.html〜47）：確認の記録があるリンクだけ
// 安全のため：
//   - 文字はすべて esc() で HTML の特別な文字を無害化してから入れる（データの中の < > & " ' を、タグや属性として解釈させない）
//   - 外部へのリンクは https で、呼び出し側が渡す許可の判定（isOkUrl）を通ったものだけ
//   - 元のページ（site/ の HTML。CSP などは scripts/check-repo.mjs で検査済み）の決まった印の間だけを差し替え、
//     出来上がったページを verifyGenerated() で検査する（script の数・CSP が元と同じ、外部リンクが許可の判定を通る）
// 生成AIはこの処理に関与しない。外部への通信はしない。

export const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const DAY = 86400000;
const jstDate = (ms) => new Date(ms + 9 * 3600000).toISOString().slice(0, 10);

export const LAYER_NAMES = {
  research: { ja: '研究と対策', en: 'Research & Response' },
  mental: { ja: 'こころ', en: 'Mental health' },
  welfare: { ja: '福祉', en: 'Welfare' },
  crime: { ja: '防犯', en: 'Crime prevention' },
  disaster: { ja: '防災', en: 'Disasters' },
};

// 今週の5〜10件を選ぶ。日本時間で今日を含む7日間に確認（checkedAt）したものを、公表日の新しい順に最大 max 件。
// min 件に足りないときは、それより前に確認したものを足す（filled: true）。表示から外れた（superseded）ものは使わない
export function pickWeekly(items, nowMs, min = 5, max = 10) {
  const count = Math.max(min, max);
  const to = jstDate(nowMs);
  const from = jstDate(nowMs - 6 * DAY);
  const usable = items.filter((x) => !x.superseded && x.source?.url);
  const byNew = (a, b) => (b.publishedAt || '').localeCompare(a.publishedAt || '') || a.id.localeCompare(b.id);
  const week = usable.filter((x) => x.checkedAt >= from && x.checkedAt <= to).sort(byNew);
  const rest = usable.filter((x) => !week.includes(x)).sort((a, b) => (b.checkedAt || '').localeCompare(a.checkedAt || '') || byNew(a, b));
  const picked = week.slice(0, count);
  const filled = picked.length < min;
  if (filled) picked.push(...rest.slice(0, min - picked.length));
  return { from, to, inWeek: Math.min(week.length, count), items: picked, filled };
}

const fmtDate = (iso, lang) => {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  if (!y) return '';
  return lang === 'en' ? new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', { timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric' }) : `${y}年${m}月${d}日`;
};
const t = (o, lang) => (lang === 'en' ? o?.en || o?.ja : o?.ja || o?.en) || '';

export function renderWeekly(week, lang, isOkUrl) {
  const en = lang === 'en';
  const out = [];
  out.push(`    <p class="item-meta">${esc(en ? `Checked between ${fmtDate(week.from, 'en')} and ${fmtDate(week.to, 'en')} (Japan time). Updated when the site is built.` : `${fmtDate(week.from, 'ja')}〜${fmtDate(week.to, 'ja')}（日本時間）に確認した情報。サイトを組み立てるたびに更新します。`)}</p>`);
  if (week.filled) out.push(`    <p class="item-meta">${esc(en ? (week.inWeek ? `Only ${week.inWeek} item(s) were added this week, so recent items are also shown.` : 'No items were added this week, so recent items are shown.') : week.inWeek ? `今週の掲載は${week.inWeek}件のため、最近の情報もあわせて載せています。` : '今週は新しい掲載がないため、最近の情報を載せています。')}</p>`);
  out.push('    <hr class="weekly-sep">');
  if (!week.items.length) {
    out.push(`    <p>${esc(en ? 'There are no items yet.' : 'まだ掲載した情報がありません。')}</p>`);
    return out.join('\n');
  }
  out.push('    <ul class="week-list">');
  for (const x of week.items) {
    const url = isOkUrl(x.source.url) ? x.source.url : null;
    const layer = LAYER_NAMES[x.layer] ? t(LAYER_NAMES[x.layer], lang) : '';
    const meta = [layer, en ? `published ${fmtDate(x.publishedAt, 'en')}` : `公表 ${fmtDate(x.publishedAt, 'ja')}`, t({ ja: x.source.name, en: x.source.name }, lang)].filter(Boolean).join(en ? ' · ' : '・');
    out.push('      <li>');
    out.push(`        <h3>${esc(t(x.title, lang))}</h3>`);
    out.push(`        <p class="item-meta">${esc(meta)}</p>`);
    out.push(`        <p>${esc((x.attribution ? t(x.attribution, lang) + (en ? ', ' : '、') : '') + t(x.summary, lang))}</p>`);
    if (url) out.push(`        <p><a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(en ? 'Open the original source' : '原典を開く')}</a></p>`);
    out.push('      </li>');
  }
  out.push('    </ul>');
  out.push(`    <p class="item-meta">${esc(en ? 'Summaries are written by this site from the original sources. If anything differs, the original source is correct.' : '要約は、このサイトが原典をもとに作成したものです。内容に違いがある場合は、原典が正となります。')}</p>`);
  return out.join('\n');
}

// RSS 2.0。項目のリンクは原典（許可の判定を通ったもの）。公開URL（base）が無いときは作らない
const rfc822 = (iso) => new Date(`${String(iso).slice(0, 10)}T00:00:00+09:00`).toUTCString();
export function renderRss(items, lang, base, nowMs, isOkUrl, count = 20) {
  if (!base) return null;
  const en = lang === 'en';
  const list = items
    .filter((x) => !x.superseded && x.source?.url && isOkUrl(x.source.url))
    .sort((a, b) => (b.checkedAt || '').localeCompare(a.checkedAt || '') || (b.publishedAt || '').localeCompare(a.publishedAt || '') || a.id.localeCompare(b.id))
    .slice(0, count);
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0">',
    '<channel>',
    `<title>${esc(en ? 'Tomoshibi Atlas — new items' : 'Tomoshibi Atlas（ともしびアトラス）新着')}</title>`,
    `<link>${esc(base + (en ? 'weekly.en.html' : 'weekly.html'))}</link>`,
    `<description>${esc(en ? 'Public information on research, mental health and welfare, crime prevention and disasters, checked against the original sources. Run by Yutaka Yoshioka (non-profit).' : '研究と対策・こころと福祉・防犯・防災の公的な情報を、原典を確認して掲載しています。運営：Yutaka Yoshioka（吉岡有隆・非営利）')}</description>`,
    `<language>${en ? 'en' : 'ja'}</language>`,
    `<lastBuildDate>${new Date(nowMs).toUTCString()}</lastBuildDate>`,
  ];
  for (const x of list) {
    lines.push('<item>');
    lines.push(`<title>${esc(t(x.title, lang))}</title>`);
    lines.push(`<link>${esc(x.source.url)}</link>`);
    lines.push(`<description>${esc((x.attribution ? t(x.attribution, lang) + (en ? ', ' : '、') : '') + t(x.summary, lang))}</description>`);
    lines.push(`<guid isPermaLink="false">tomoshibi-atlas:${esc(x.id)}</guid>`);
    if (x.publishedAt) lines.push(`<pubDate>${rfc822(x.publishedAt)}</pubDate>`);
    lines.push('</item>');
  }
  lines.push('</channel>', '</rss>', '');
  return lines.join('\n');
}

// 都道府県
const ROLE = { main: '生活の困りごと', mind: 'こころの健康', bousai: '災害・防災' };
export const prefFile = (p) => `welfare-pref-${p.code}.html`;

export function renderPrefIndex(prefs) {
  const out = [`    <h2>${kanaPair('都道府県を選ぶ', 'とどうふけんを えらぶ')}</h2>`, '    <ul class="pref-grid">'];
  for (const p of prefs) out.push(`      <li><a href="${esc(prefFile(p))}">${esc(p.ja)}</a></li>`);
  out.push('    </ul>');
  return out.join('\n');
}


// 救急の電話相談（＃7119）の実施状況。消防庁「救急安心センター事業（♯7119）」のページの一覧を、運用者が写したもの（確認日 checkedAt）
// [状況, 対象年齢, 補足] 状況：all … 都道府県のほぼ全域（補足に除く地域）／ part … 一部の地域だけ／ none … 実施していない
// 対象年齢：all … 全年齢／ 15 … 概ね15歳以上（15歳未満は＃8000）。見直しのときは出典の最新の一覧で47都道府県すべてを照合する
export const ER_SOURCE = { name: '消防庁「救急安心センター事業（♯7119）」の実施地域の一覧', url: 'https://www.fdma.go.jp/mission/enrichment/appropriate/appropriate007.html', checkedAt: '2026-11-19' };
export const ER7119 = {
  '01': ['part', 'all', '札幌市とその周辺の市町村'], '02': ['all', '15'], '03': ['all', '15'], '04': ['all', '15'], '05': ['all', '15'], '06': ['all', '15'], '07': ['all', '15'],
  '08': ['all', '15'], '09': ['all', '15'], '10': ['all', 'all'], '11': ['all', 'all'], '12': ['all', '15'], '13': ['all', 'all'], '14': ['all', 'all'],
  '15': ['all', '15'], '16': ['all', '15'], '17': ['all', '15'], '18': ['all', '15'], '19': ['all', 'all'], '20': ['all', '15'], '21': ['all', 'all'],
  '22': ['all', '15'], '23': ['part', '15', '名古屋市'], '24': ['none'], '25': ['all', '15'], '26': ['all', 'all'], '27': ['all', 'all'], '28': ['all', 'all'],
  '29': ['all', 'all'], '30': ['part', 'all', '田辺市とその周辺の市町'], '31': ['all', '15'], '32': ['none'], '33': ['all', 'all'], '34': ['all', 'all', '大崎上島町を除く'],
  '35': ['all', '15', '萩市・阿武町を除く。岩国市・和木町は広島の窓口（全年齢）'], '36': ['all', '15'], '37': ['all', '15'], '38': ['all', '15'], '39': ['all', 'all'],
  '40': ['all', 'all'], '41': ['none'], '42': ['all', 'all'], '43': ['all', '15'], '44': ['all', '15'], '45': ['none'], '46': ['none'], '47': ['all', 'all', '北大東村・与那国町を除く'],
};
const AGE = { all: '全年齢', 15: '概ね15歳以上（15歳未満は＃8000）' };
export function er7119Text(code) {
  const [st, age, note] = ER7119[code] || [];
  if (st === 'all') return `＃7119：実施（${note ? note + '・' : ''}${AGE[age]}）`;
  if (st === 'part') return `＃7119：一部の地域で実施（${note}・${AGE[age]}）`;
  if (st === 'none') return '＃7119：実施していません（都道府県・市町村の救急相談の窓口をご確認ください）';
  return '＃7119：確認中';
}
// 「急な病気・けがのとき」のページの、都道府県ごとの救急相談の表
// 窓口ごとの受付時間（data/curated/er-lines.json。運用者が出典と照合したときだけ出す）。
// 窓口ごとの直通の番号は載せない（＃7119 などの短い番号だけを案内し、つながらないときは消防庁の一覧へ案内する）
export function erCentersOf(code, er) {
  if (!er || !er.show) return [];
  return er.centers.filter((c) => c.prefs.includes(code));
}
function erCenterHtml(c) {
  return `<span class="er-center">${esc(c.name)}：${esc(c.hours)}</span>`;
}
// ＃7119 がつながらないとき（直通の番号はここには載せず、消防庁の一覧へ案内する）
const ER_NO_CONNECT = '＃7119 がつながらない電話（ダイヤル回線・一部のIP電話など）や地域があります。そのときは、下の消防庁の一覧で、お住まいの地域の番号をご確認ください。';
const ER_NO_CONNECT_KANA = '＃7119 が つながらない でんわ（ダイヤル かいせん・いちぶの IP でんわ など）や ちいきが あります。その ときは、しょうぼうちょうの いちらんで、おすまいの ちいきの ばんごうを ごかくにん ください。';
export function renderErTable(prefs, er) {
  const out = ['    <table class="er-table">', '      <thead><tr><th scope="col">都道府県</th><th scope="col">救急の電話相談（＃7119）・受付時間</th><th scope="col">子ども（＃8000）</th></tr></thead>', '      <tbody>'];
  for (const p of prefs) {
    const centers = erCentersOf(p.code, er).map(erCenterHtml).join('');
    out.push(`        <tr><th scope="row"><a href="${esc(prefFile(p))}">${esc(p.ja)}</a></th><td>${esc(er7119Text(p.code).replace(/^＃7119：/, ''))}${centers}</td><td>実施</td></tr>`);
  }
  out.push('      </tbody>', '    </table>');
  if (er && !er.show) out.push(er.expired ? '    <p class="item-meta">窓口ごとの受付時間は、運用者の確認の時期を過ぎたため、いまは載せていません。下の消防庁の一覧でご確認ください。</p>' : '    <p class="item-meta">窓口ごとの受付時間は、運用者が消防庁の一覧と照らし合わせたあとに載せます（いまは確認中）。</p>');
  out.push(`    <p class="item-meta">${ER_NO_CONNECT}</p>`);
  out.push(`    <p class="item-meta">出典：<a href="${esc(ER_SOURCE.url)}" target="_blank" rel="noopener noreferrer">${esc(ER_SOURCE.name)}</a>（確認日 ${esc(ER_SOURCE.checkedAt)}）、<a href="https://kakarikata.mhlw.go.jp/kakaritsuke/8000.html" target="_blank" rel="noopener noreferrer">厚生労働省「子どもの症状は＃8000」</a>（全国47都道府県で実施）。＃7119 以外の番号で救急の電話相談をしている地域もあります。番号・受付時間・対象地域・対象年齢は変わることがあるため、お住まいの都道府県・市町村の公式サイトでもご確認ください。</p>`);
  return out.join('\n');
}

export function renderPrefPage(p, prefs, isOkUrl, er) {
  const out = [];
  const shown = (p.links || []).filter((l) => isOkUrl(l.url));
  const local = (p.local || []).filter((l) => isOkUrl(l.url));
  out.push(`    <h2>${kanaPair(`${p.ja}の公式の相談先・災害情報`, `${prefKanaOf(p)}の こうしきの そうだんさき・さいがい じょうほう`)}</h2>`);
  if (shown.length) {
    out.push('    <ul>');
    for (const l of shown) out.push(`      <li>${esc(ROLE[l.role] ? `【${ROLE[l.role]}】` : '')}<a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(t(l.title, 'ja'))}</a></li>`);
    out.push('    </ul>');
  } else out.push(`    <p>${kanaPair('確認できた公式のページを準備しています。下の「困りごと別の探し方」から、国の相談先をご覧ください。', 'かくにん できた こうしきの ページを じゅんび して います。したの「こまりごと べつの さがしかた」から、くにの そうだんさきを ごらん ください。')}</p>`);
  // 役所の公式サイト：都道府県庁のトップと、市区町村（市役所・区役所・町村役場）の公式サイトを探す国の案内
  const top = prefTopUrl(p);
  out.push(`    <h2>${kanaPair('役所の公式サイト', 'やくしょの こうしき サイト')}</h2>`);
  out.push('    <ul>');
  if (top && isOkUrl(top)) {
    const a = (txt) => `<a href="${esc(top)}" target="_blank" rel="noopener noreferrer">${esc(txt)}</a>`;
    out.push(`      <li>${kanaRaw(`【都道府県庁】${a(`${p.ja}の公式サイト（トップページ）`)}`, `【とどうふけんちょう】${a(`${prefKanaOf(p)}の こうしき サイト（トップ ページ）`)}`)}</li>`);
  }
  const ms = (txt) => `<a href="${esc(MUNI_SEARCH.url)}" target="_blank" rel="noopener noreferrer">${esc(txt)}</a>`;
  out.push(`      <li>${kanaRaw(`【市区町村】お住まいの市役所・区役所・町村役場の公式サイトは、${ms(MUNI_SEARCH.ja)}から探せます。窓口の場所・受付時間は、市区町村の公式サイトで確かめてください。`, `【しくちょうそん】おすまいの しやくしょ・くやくしょ・ちょうそん やくばの こうしき サイトは、${ms('ちほう こうきょう だんたい じょうほう システム きこう（J-LIS）「ぜんこく じちたい マップ けんさく」')}から さがせます。まどぐちの ばしょ・うけつけ じかんは、しくちょうそんの こうしき サイトで たしかめて ください。`)}</li>`);
  out.push('    </ul>');
  if (local.length) {
    out.push(`    <h2>${kanaPair('市区町村・社会福祉協議会の相談ページ', 'しくちょうそん・しゃかい ふくし きょうぎかいの そうだんの ページ')}</h2>`);
    out.push(`    <p class="item-meta">${kanaPair('主な市区町村と社会福祉協議会のページです。お住まいの市区町村が無いときは、その市区町村の公式サイトで「生活困窮」「福祉の相談」などと探すか、都道府県のページの案内をご覧ください。', 'おもな しくちょうそんと しゃかい ふくし きょうぎかいの ページ です。おすまいの しくちょうそんが ない ときは、その しくちょうそんの こうしき サイトで「せいかつ こんきゅう」「ふくしの そうだん」などと さがすか、とどうふけんの ページの あんないを ごらん ください。')}</p>`);
    out.push('    <ul>');
    for (const l of local) out.push(`      <li>${esc(t(l.name, 'ja'))}：<a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(t(l.title, 'ja'))}</a></li>`);
    out.push('    </ul>');
  }
  out.push(`    <p class="item-meta">${kanaPair('リンク先は、運用者またはAIが公式のページであることを確かめたものだけです（確認の記録が無いものは載せていません）。窓口の受付時間や内容は、リンク先でご確認ください。', 'リンクさきは、うんようしゃ または AI が こうしきの ページで あることを たしかめた もの だけ です（かくにんの きろくが ない ものは のせて いません）。まどぐちの うけつけ じかんや ないようは、リンクさきで ごかくにん ください。')}</p>`);
  out.push(`    <h2>${kanaPair('急な病気・けがの電話相談', 'きゅうな びょうき・けがの でんわ そうだん')}</h2>`);
  const centers = erCentersOf(p.code, er).map((c) => `\n      <li>${erCenterHtml(c)}</li>`).join('');
  out.push(`    <ul>\n      <li>${esc(er7119Text(p.code))}</li>${centers}\n      <li>${kanaPair('＃8000（子どもの急な病気）：実施', '＃8000（こどもの きゅうな びょうき）：じっし')}</li>\n    </ul>`);
  out.push(`    <p class="item-meta">${kanaPair(ER_NO_CONNECT.replace('下の消防庁', '消防庁'), ER_NO_CONNECT_KANA)}</p>`);
  const src = `<a href="${esc(ER_SOURCE.url)}" target="_blank" rel="noopener noreferrer">${esc(ER_SOURCE.name)}</a>`;
  // ひらがな表示では、出典の名前も読みで出す（リンク先は同じ）
  const srcKana = `<a href="${esc(ER_SOURCE.url)}" target="_blank" rel="noopener noreferrer">しょうぼうちょう「きゅうきゅう あんしん センター じぎょう（＃7119）」の じっし ちいきの いちらん</a>`;
  out.push(`    <p class="item-meta">${kanaRaw(`出典：${src}（確認日 ${esc(ER_SOURCE.checkedAt)}）。命にかかわると感じたら、迷わず119番へ。くわしくは<a href="emergency-care.html">急な病気・けがのとき</a>のページへ。`, `しゅってん：${srcKana}（かくにんび ${esc(ER_SOURCE.checkedAt)}）。いのちに かかわると かんじたら、まよわず 119ばんへ。くわしくは <a href="emergency-care.html">きゅうな びょうき・けがの とき</a>の ページへ。`)}</p>`);
  out.push(`    <h2>${kanaPair('全国共通の探し方（このサイトのまとめ）', 'ぜんこく きょうつうの さがしかた（この サイトの まとめ）')}</h2>`);
  out.push('    <ul>');
  for (const [href, text, kana] of [
    ['disability-services.html', '障がいのある人の福祉サービス・施設（生活介護・リハビリ・作業所・就労支援など）の探し方', 'しょうがいの ある ひとの ふくし サービス・しせつ（せいかつ かいご・リハビリ・さぎょうしょ・しゅうろう しえん など）の さがしかた'],
    ['family-support.html', 'ひとり親家庭（母子家庭・父子家庭）の支援の探し方', 'ひとりおや かてい（ぼし かてい・ふし かてい）の しえんの さがしかた'],
    ['emergency-care.html', '急な病気・けがのとき（救急車を呼ぶか迷ったら・応急手当）', 'きゅうな びょうき・けがの とき（きゅうきゅうしゃを よぶか まよったら・おうきゅう てあて）'],
    ['crime-prevention.html', '防犯対策（詐欺・闇バイト）と相談先', 'ぼうはん たいさく（さぎ・やみバイト）と そうだんさき'],
  ])
    out.push(`      <li><a href="${esc(href)}">${kanaPair(text, kana)}</a></li>`);
  out.push('    </ul>');
  out.push(`    <h2>${kanaPair('ほかの都道府県', 'ほかの とどうふけん')}</h2>`);
  out.push('    <ul class="pref-grid">');
  for (const q of prefs) out.push(`      <li><a href="${esc(prefFile(q))}"${q.code === p.code ? ' aria-current="page"' : ''}>${esc(q.ja)}</a></li>`);
  out.push('    </ul>');
  return out.join('\n');
}

// 人間の確認が済んでいない外部リンク（shouldUnlink が true）を外し、文字と「（確認待ち）」だけを残す。
// 「急な病気・けがのとき」のページで、運用者が月1回の確認をしていないリンクを公開しないために使う
export function unlinkUnchecked(html, shouldUnlink) {
  return html.replace(/<a href="(https:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/g, (all, href, text) => (shouldUnlink(href.replace(/&amp;/g, '&')) ? `<span class="link-pending">${text}<small>（リンクは運用者の確認待ち）</small></span>` : all));
}

import { prefTopUrl, MUNI_SEARCH, PREF_KANA } from '../../site/js/pref-top.js';
// 「ひらがなで よむ」用：漢字の表示と読みを並べる（切り替えは CSS）
export const kanaPair = (std, alt) => `<span class="kana-std">${esc(std)}</span><span class="kana-alt">${esc(alt)}</span>`;
// 中にリンクを含むとき用（std・alt は、呼ぶ側で esc 済みの HTML を渡す）
export const kanaRaw = (std, alt) => `<span class="kana-std">${std}</span><span class="kana-alt">${alt}</span>`;
export const prefKanaOf = (p) => PREF_KANA[Number(p.code) - 1] || p.ja;

// 決まった印（<!-- gen:名前 --> 〜 <!-- /gen:名前 -->）の間を差し替える。印が無いときは例外（作り間違いで中身の無いページを公開しない）
export function replaceBlock(html, name, content) {
  const re = new RegExp(`<!-- gen:${name} -->[\\s\\S]*?<!-- /gen:${name} -->`);
  if (!re.test(html)) throw new Error(`印 gen:${name} が見つからない`);
  return html.replace(re, () => content);
}
// 印だけを消して、間の中身を残す（RSS を作ったときの案内リンクなど）
export function unwrapBlock(html, name) {
  const re = new RegExp(`<!-- gen:${name} -->([\\s\\S]*?)<!-- /gen:${name} -->`);
  if (!re.test(html)) throw new Error(`印 gen:${name} が見つからない`);
  return html.replace(re, (_, inner) => inner);
}
// title・説明（meta description・og）を差し替える
export function replaceHead(html, { title, desc }) {
  let out = html;
  if (title) out = out.replace(/<title>[^<]*<\/title>/, () => `<title>${esc(title)}</title>`).replace(/<meta property="og:title" content="[^"]*">/, () => `<meta property="og:title" content="${esc(title)}">`);
  if (desc) out = out.replace(/<meta name="description" content="[^"]*">/, () => `<meta name="description" content="${esc(desc)}">`).replace(/<meta property="og:description" content="[^"]*">/, () => `<meta property="og:description" content="${esc(desc)}">`);
  // 構造化データ（JSON-LD）の「このページ」（WebPage）の名前と説明も、同じものに差し替える（「<」は文字の印に置き換え、script を閉じさせない）
  out = out.replace(/(<script type="application\/ld\+json">)([\s\S]*?)(<\/script>)/, (all, a, json, b) => {
    let doc;
    try {
      doc = JSON.parse(json);
    } catch {
      return all;
    }
    const page = (doc['@graph'] || []).find((n) => n['@type'] === 'WebPage');
    if (!page) return all;
    if (title) page.name = title;
    if (desc) page.description = desc;
    return a + JSON.stringify(doc).replace(/</g, '\\u003c') + b;
  });
  return out;
}

// 出来上がったページの検査：CSP と script の数が元のページと同じ・イベント属性なし・外部リンクは許可の判定を通るもの・印が残っていない
// 電話をかけるリンクは、救急と警察の番号だけを許す（急な病気・けが、防犯のページの控えめなボタン。2026-11-20 運用者が承認）
export const TEL_OK = new Set(['tel:119', 'tel:%237119', 'tel:%238000', 'tel:110', 'tel:%239110']);
export function verifyGenerated(html, template, isOkUrl) {
  const errors = [];
  const csp = (h) => (h.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/) || [])[1];
  if (!csp(html) || csp(html) !== csp(template)) errors.push('CSP が元のページと違う');
  const count = (h) => (h.match(/<script\b/gi) || []).length;
  if (count(html) !== count(template)) errors.push('script の数が元のページと違う');
  const body = html.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g, '');
  if (/\son[a-z]+\s*=/i.test(body)) errors.push('イベント属性がある');
  if (/<(?:iframe|embed|object|form)\b/i.test(body)) errors.push('iframe などがある');
  for (const m of body.matchAll(/\bhref="([^"]*)"/g)) {
    const raw = m[1].replace(/&amp;/g, '&');
    if (/^https:\/\//.test(raw)) {
      if (!isOkUrl(raw)) errors.push(`許可されていない外部リンク（${raw}）`);
    } else if (TEL_OK.has(raw)) continue;
    else if (/^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith('//')) errors.push(`使えない形のリンク（${raw}）`);
  }
  if (/<!-- \/?gen:/.test(html)) errors.push('差し替えの印が残っている');
  return errors;
}
