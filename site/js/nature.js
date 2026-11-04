// 情報の性質（「情報の確かさ」の表示）。すべての分野・ページで同じ言葉を使うための共通の定義。
// 手動掲載の項目は、運用者が原典を確かめて nature（statistics / estimate / preliminary / official）を書くことがある
// （scripts/validate-data.mjs の NATURES と合わせる）。書いていないときは、次の順で決める：
//   地震（USGS の自動の値を含む）→ 速報値／査読論文 → 研究（査読論文）／開発元の発表 → 開発元の発表／今日の動物たち → 豆知識／それ以外 → 公式発表
// 性質は「どういう種類の情報か」を示すもので、内容が正しいかどうかの評価ではない。

export const NATURE_LABELS = {
  ja: {
    official: ['公式発表', '発表した機関の情報です。内容は後で更新されることがあります。'],
    statistics: ['統計', '公的な調査・集計の結果です（標本調査にもとづく推計値を含みます）。調査年や定義は原典で確認してください。'],
    estimate: ['試算・推計', 'モデルや一定の前提にもとづく計算です。確定した値や将来の予測とは限りません。'],
    preliminary: ['速報値・暫定値', 'まとめた時点の値です。後で更新・改訂されることがあります。'],
    research: ['研究（査読論文）', '専門家の審査を経た論文です。1つの研究の結果で、確定した事実とは限りません。'],
    vendor: ['開発元の発表', '製品の開発元自身の発表です。第三者による検証ではありません。'],
    fact: ['豆知識', '公的な博物館・動物園などの原典で確かめた内容です。'],
  },
  en: {
    official: ['Official announcement', 'Information from the publishing body. It may be updated later.'],
    statistics: ['Statistics', 'Results of an official survey or count (including estimates from sample surveys). Check the survey year and definitions in the original.'],
    estimate: ['Estimate / projection', 'A calculation based on a model or assumptions. It is not necessarily a final figure or a forecast.'],
    preliminary: ['Preliminary', 'Figures as of the time they were compiled. They may be updated or revised later.'],
    research: ['Peer-reviewed research', 'A paper reviewed by experts. It is the result of one study, not necessarily an established fact.'],
    vendor: ['Developer announcement', "The product developer's own announcement, not an independent verification."],
    fact: ['Fun fact', 'Checked against sources such as public museums and zoos.'],
  },
};

const OVERRIDES = new Set(['official', 'statistics', 'estimate', 'preliminary']);

export function natureOf(item) {
  if (!item) return 'official';
  if (item.layer === 'animals') return 'fact';
  if (item.layer === 'quake') return 'preliminary';
  if (OVERRIDES.has(item.nature) && (item.sourceType === 'public_agency' || item.sourceType === 'intl_org')) return item.nature;
  if (item.sourceType === 'peer_reviewed') return 'research';
  if (item.sourceType === 'vendor') return 'vendor';
  return 'official';
}

// 画面に出す小さな印（span）。title 属性に短い説明を入れ、画面の読み上げでも分かるように「情報の性質：」を前に付ける
export function natureBadge(item, lang = 'ja', key = natureOf(item)) {
  const L = NATURE_LABELS[lang === 'en' ? 'en' : 'ja'][key] || NATURE_LABELS.ja.official;
  const s = document.createElement('span');
  s.className = 'badge nature nature-' + key;
  s.textContent = L[0];
  s.title = L[1];
  const sr = document.createElement('span');
  sr.className = 'visually-hidden';
  sr.textContent = lang === 'en' ? 'Nature of information: ' : '情報の性質：';
  s.prepend(sr);
  return s;
}
