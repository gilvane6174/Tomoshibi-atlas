// 都道府県庁の公式サイトのトップと、市区町村の公式サイトを探す国の案内（福祉の探し方と、都道府県別のページで使う）。
// ホスト名は、確認済みの都道府県のページ（data/directory/prefectures.json）と同じ公式のドメイン（許可リストにあるもの）。
// 東京都・沖縄県は、都庁・県庁のトップのドメインを指定（東京都は2026-11-20に許可リストへ追加）。
export const PREF_TOP_OVERRIDE = { 13: 'https://www.metro.tokyo.lg.jp/', 47: 'https://www.pref.okinawa.lg.jp/' };
// 地方公共団体情報システム機構（J-LIS）「全国自治体マップ検索」（総務省「電子自治体」のリンク集に掲載）
export const MUNI_SEARCH = { url: 'https://www.j-lis.go.jp/map-search/cms_1069.html', ja: '地方公共団体情報システム機構（J-LIS）「全国自治体マップ検索」', en: 'J-LIS local government map search (Japanese)' };
export function prefTopUrl(p) {
  if (Number(p.code) in PREF_TOP_OVERRIDE) return PREF_TOP_OVERRIDE[Number(p.code)];
  const main = (p.links || []).find((l) => l.role === 'main') || (p.links || [])[0];
  if (!main) return null;
  try {
    const top = new URL('/', main.url);
    return top.protocol === 'https:' ? top.href : null;
  } catch {
    return null;
  }
}

// 都道府県名の読み（ひらがなで よむ ときに使う。都道府県コードの順）
export const PREF_KANA = ('ほっかいどう あおもりけん いわてけん みやぎけん あきたけん やまがたけん ふくしまけん いばらきけん とちぎけん ぐんまけん ' +
  'さいたまけん ちばけん とうきょうと かながわけん にいがたけん とやまけん いしかわけん ふくいけん やまなしけん ながのけん ' +
  'ぎふけん しずおかけん あいちけん みえけん しがけん きょうとふ おおさかふ ひょうごけん ならけん わかやまけん ' +
  'とっとりけん しまねけん おかやまけん ひろしまけん やまぐちけん とくしまけん かがわけん えひめけん こうちけん ふくおかけん ' +
  'さがけん ながさきけん くまもとけん おおいたけん みやざきけん かごしまけん おきなわけん').split(' ');
