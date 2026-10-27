// 表示データの検査。1件でも違反があれば失敗（終了コード1）にして、公開・マージを止める。
// 使い方: node scripts/validate-data.mjs   … data/curated（本番の2ファイル）と相談先リンク集を検査
// build.mjs からも validateItems() を呼び、自動取得分も同じ基準で検査する。

import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { scanText } from './check-privacy.mjs';
import { DATA_ROOT, readCode, readData, isAllowedUrl, isDirectoryUrl, isAnimalUrl, looksLikeHtml, isValidDate, findForbidden, findAttackDetail, hasInvisible, hasMixedScript, notFutureJst, siWithoutExplanation, mentionsSuperIntelligence } from './lib/safety.mjs';

export const LAYERS = ['outbreak', 'research', 'mental', 'welfare', 'security', 'crime', 'disaster', 'quake'];
export const CURATED_LAYERS = ['research', 'mental', 'welfare', 'crime', 'disaster'];
// 相談先リンク集・公式Xアカウントで使える分野（防犯・防災はリンク集を表示しないため含めない。site/js/data.js の DIR_LAYERS と合わせる）
const DIR_LAYER_IDS = ['outbreak', 'research', 'mental', 'welfare', 'security'];
export const TAGS = ['ransomware', 'ai', 'statistics', 'support', 'policy', 'early-stage', 'approved', 'security', 'disaster', 'crime'];
const PLACE_BASIS = ['reported_country', 'publisher_country', 'global', 'unknown'];
const CURATED_PLACE_BASIS = ['reported_country', 'global'];
// vendor … 製品の開発元の公式発表（セキュリティ更新の配布など。研究と対策の分野だけ）
const SOURCE_TYPES = ['peer_reviewed', 'public_agency', 'intl_org', 'vendor'];
const COUNTRY_IDS = new Set(readCode('site/data/geo/country-index.json').map((c) => c.id));
const ID = /^[a-z0-9][a-z0-9-]{2,120}$/;
const TOPIC = /^[a-z0-9][a-z0-9-]{1,59}$/;
// 更新履歴の作業者名は、ops/ROLES.md の役割名だけ（個人名・製品名・アカウント名は書けない）
export const ACTORS = ['operator', 'ai-curator', 'bot-curator', 'ai-security-audit', 'ai-fact-check', 'ai-translation-audit', 'ai-balance-audit'];
const ITEM_KEYS = new Set(['id', 'layer', 'title', 'summary', 'attribution', 'tags', 'topic', 'countries', 'placeBasis', 'importance', 'publishedAt', 'checkedAt', 'source', 'sourceType', 'links']);
const TEXT_KEYS = new Set(['ja', 'en', 'original']);
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

// すべての文字列を検査：HTML混入・見えない文字・長さ・（手動データでは）断定表現
function walkStrings(value, path, errors, { curated, maxLen = 400 }) {
  if (typeof value === 'string') {
    if (looksLikeHtml(value)) errors.push(`${path}: HTMLタグらしき文字列は使用不可`);
    if (hasInvisible(value)) errors.push(`${path}: 制御文字・ゼロ幅文字・双方向制御文字などの見えない文字は使用不可`);
    if (value.length > maxLen) errors.push(`${path}: 長すぎる（${value.length}文字 > ${maxLen}）`);
    if (curated) {
      for (const label of scanText(value)) errors.push(`${path}: 個人情報・秘密情報の疑い（${label}）`);
      for (const w of findForbidden(value)) errors.push(`${path}: 断定・誇大・優劣表現（${w}）は使用不可`);
      if (value.includes('障害')) errors.push(`${path}: 表記のルール：「障害」ではなく「障がい」と書く（ops/CURATION.md）`);
      for (const w of findAttackDetail(value)) errors.push(`${path}: 悪用防止のため掲載不可（${w}）。攻撃のやり方や痕跡情報は載せず、公式の対処情報へのリンクにとどめる`);
      if (hasMixedScript(value)) errors.push(`${path}: ラテン文字とキリル・ギリシャ文字が1語に混在（偽装の疑い）`);
    }
  } else if (Array.isArray(value)) value.forEach((v, i) => walkStrings(v, `${path}[${i}]`, errors, { curated, maxLen }));
  else if (isObj(value)) for (const [k, v] of Object.entries(value)) walkStrings(v, `${path}.${k}`, errors, { curated, maxLen });
  else if (value !== null && typeof value !== 'boolean' && typeof value !== 'number') errors.push(`${path}: 想定外の値`);
}

// {"ja": "...", "en": "..."} 形式の検査。need に挙げた言語は必須
function checkText(obj, path, errors, { need = [], max }) {
  if (obj === undefined && need.length === 0) return;
  if (!isObj(obj)) return errors.push(`${path}: {"ja": "...", "en": "..."} の形式が必要`);
  for (const k of Object.keys(obj)) if (!TEXT_KEYS.has(k)) errors.push(`${path}.${k}: 使えないキー（ja / en / original のみ）`);
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v !== 'string') errors.push(`${path}.${k}: 文字列が必要`);
    else if (max && [...v].length > max) errors.push(`${path}.${k}: ${max}文字以内`);
  }
  for (const lang of need) if (!(typeof obj[lang] === 'string' && obj[lang].trim())) errors.push(`${path}.${lang} が必須`);
}

export function validateItems(items, { layer, curated }) {
  const errors = [];
  if (!Array.isArray(items)) return [`${layer || 'items'}: items が配列ではない`];
  const ids = new Set();
  items.forEach((it, i) => {
    const p = `${it?.layer || layer}[${i}]${typeof it?.id === 'string' ? '(' + it.id.slice(0, 60) + ')' : ''}`;
    if (!isObj(it)) return errors.push(`${p}: 項目がオブジェクトではない`);
    for (const k of Object.keys(it)) if (!ITEM_KEYS.has(k)) errors.push(`${p}.${k}: 定義されていない項目名`);
    walkStrings(it, p, errors, { curated });

    const allowedLayers = curated ? CURATED_LAYERS : layer ? [layer] : LAYERS;
    if (!allowedLayers.includes(it.layer)) errors.push(`${p}: layer は ${allowedLayers.join(' / ')}`);
    if (typeof it.id !== 'string' || !ID.test(it.id)) errors.push(`${p}: id の形式が不正（英小文字・数字・ハイフン）`);
    else if (curated && !it.id.startsWith(it.layer + '-')) errors.push(`${p}: id は「${it.layer}-」で始める`);
    if (ids.has(it.id)) errors.push(`${p}: id が重複`);
    ids.add(it.id);

    // 手動掲載は日英とも必須。自動取得は原文の言語だけでよい（日本語か英語のどちらかは必須。機械翻訳しない）
    const both = curated ? ['ja', 'en'] : [];
    checkText(it.title, `${p}.title`, errors, { need: both, max: curated ? 80 : 300 });
    if (!curated && !(typeof it.title?.ja === 'string' && it.title.ja.trim()) && !(typeof it.title?.en === 'string' && it.title.en.trim())) errors.push(`${p}.title: ja か en のどちらかが必須`);
    checkText(it.summary, `${p}.summary`, errors, { need: curated ? both : [], max: 200 });
    checkText(it.attribution, `${p}.attribution`, errors, { need: curated && it.layer === 'welfare' ? both : [], max: 80 });
    if (it.topic !== undefined && (typeof it.topic !== 'string' || !TOPIC.test(it.topic))) errors.push(`${p}: topic は英小文字・数字・ハイフン（2〜60文字）`);
    if (!['major', 'minor'].includes(it.importance)) errors.push(`${p}: importance は major / minor`);

    const bases = curated ? CURATED_PLACE_BASIS : PLACE_BASIS;
    if (!bases.includes(it.placeBasis)) errors.push(`${p}: placeBasis は ${bases.join(' / ')}`);
    if (!Array.isArray(it.countries) || it.countries.some((c) => typeof c !== 'string')) errors.push(`${p}: countries は国コード（文字列）の配列`);
    else {
      for (const c of it.countries) if (!COUNTRY_IDS.has(c)) errors.push(`${p}: 国コード ${c} が索引にない`);
      if (new Set(it.countries).size !== it.countries.length) errors.push(`${p}: countries に重複`);
      if (['reported_country', 'publisher_country'].includes(it.placeBasis) && it.countries.length === 0)
        errors.push(`${p}: 国を指定する placeBasis なのに countries が空`);
      if (['global', 'unknown'].includes(it.placeBasis) && it.countries.length > 0) errors.push(`${p}: global / unknown のときは countries を空にする`);
    }
    if (!isValidDate(it.publishedAt) || (curated && !notFutureJst(it.publishedAt))) errors.push(`${p}: publishedAt が不正な日付、または未来日`);

    if (!isObj(it.source) || typeof it.source.name !== 'string' || !it.source.name.trim()) errors.push(`${p}: source.name が必須`);
    else if (Object.keys(it.source).some((k) => !['name', 'url'].includes(k))) errors.push(`${p}: source は name と url のみ`);
    if (!isAllowedUrl(it.source?.url, { strict: curated })) errors.push(`${p}: source.url が許可リスト外・https でない・?や#を含む`);

    if (it.links !== undefined) {
      if (!Array.isArray(it.links)) errors.push(`${p}: links は配列`);
      else
        it.links.forEach((l, j) => {
          if (!isObj(l) || typeof l.label !== 'string' || !l.label.trim() || Object.keys(l).some((k) => !['label', 'url'].includes(k)))
            errors.push(`${p}.links[${j}]: {"label": "...", "url": "..."} の形式が必要`);
          else if (!isAllowedUrl(l.url, { strict: curated })) errors.push(`${p}.links[${j}]: URL が許可リスト外・https でない・?や#を含む`);
        });
    }
    if (it.tags !== undefined && (!Array.isArray(it.tags) || it.tags.some((t) => !TAGS.includes(t))))
      errors.push(`${p}: tags は ${TAGS.join(' / ')} のみ`);

    if (curated) {
      // 「SI」だけの表記は意味が分からないため、説明を添える（リンク集の SI-CERT などの固有名は対象外）
      for (const [k, obj] of [['title', it.title], ['summary', it.summary], ['attribution', it.attribution]])
        for (const lang of ['ja', 'en']) if (typeof obj?.[lang] === 'string' && siWithoutExplanation(obj[lang])) errors.push(`${p}.${k}.${lang}: 「SI」だけでは意味が分からないため、「SI（Super Intelligence。米国政府の文書でのAIの呼び方）」のように説明を添える（ops/CURATION.md）`);
      // SI（Super Intelligence）と書かれた AI 関連の情報は、AI の情報として「ai」の印を付ける
      if (mentionsSuperIntelligence(JSON.stringify([it.title, it.summary, it.attribution])) && !(it.tags || []).includes('ai')) errors.push(`${p}: SI（Super Intelligence）の情報は AI 関連として tags に ai を付ける`);
      if (!SOURCE_TYPES.includes(it.sourceType)) errors.push(`${p}: sourceType は peer_reviewed / public_agency / intl_org / vendor`);
      else if (it.sourceType === 'vendor' && it.layer !== 'research') errors.push(`${p}: 開発元の発表（vendor）は「研究と対策」の分野だけ`);
      if (!isValidDate(it.checkedAt) || !notFutureJst(it.checkedAt)) errors.push(`${p}: checkedAt（原典を確認した日）が必須。未来日は不可`);
      else if (isValidDate(it.publishedAt) && it.checkedAt < it.publishedAt.slice(0, 10)) errors.push(`${p}: checkedAt が公表日より前`);
    }
  });
  return errors;
}

// 更新履歴の検査。手動データのすべての id が、どこかの履歴に記録されていること
export function validateChangelog(doc, itemIds, rel) {
  const errors = [];
  if (!isObj(doc)) return [`${rel}: 先頭はオブジェクト`];
  for (const k of Object.keys(doc)) if (!['schemaVersion', 'entries'].includes(k)) errors.push(`${rel}.${k}: 定義されていない項目名`);
  if (doc.schemaVersion !== 1) errors.push(`${rel}: schemaVersion は 1`);
  if (!Array.isArray(doc.entries)) return [...errors, `${rel}: entries は配列`];
  const logged = new Set();
  doc.entries.forEach((e, i) => {
    const p = `${rel}.entries[${i}]`;
    if (!isObj(e)) return errors.push(`${p}: オブジェクトが必要`);
    for (const k of Object.keys(e)) if (!['date', 'by', 'summary', 'ids'].includes(k)) errors.push(`${p}.${k}: 定義されていない項目名`);
    walkStrings(e, p, errors, { curated: true, maxLen: 200 });
    if (!isValidDate(e.date) || !notFutureJst(e.date)) errors.push(`${p}: date が不正、または未来日`);
    if (!ACTORS.includes(e.by)) errors.push(`${p}: by は ${ACTORS.join(' / ')} のいずれか（個人名・製品名は書かない）`);
    checkText(e.summary, `${p}.summary`, errors, { need: ['ja', 'en'], max: 200 });
    if (!Array.isArray(e.ids) || e.ids.some((x) => typeof x !== 'string' || !ID.test(x))) errors.push(`${p}: ids は id の配列`);
    else e.ids.forEach((x) => logged.add(x));
  });
  for (const id of itemIds) if (!logged.has(id)) errors.push(`${rel}: 項目 ${id} の追加・変更が更新履歴に記録されていない`);
  return errors;
}

export function validateCuratedPair(entriesRel, changelogRel) {
  let entriesRaw, changelogRaw, entries, changelog;
  try {
    entriesRaw = readFileSync(resolve(DATA_ROOT, entriesRel), 'utf8');
    changelogRaw = readFileSync(resolve(DATA_ROOT, changelogRel), 'utf8');
    entries = readData(entriesRel);
    changelog = readData(changelogRel);
  } catch (e) {
    return [`JSONとして読めない（${e.message}）`];
  }
  return validateCuratedDocs({ entries, changelog, entriesRaw, changelogRaw, entriesRel, changelogRel });
}

// 書き込む前の「完成予定のデータ」も同じ基準で検査できるように、ファイルを読まずに中身だけで検査する版
// （scripts/add-candidates.mjs が、本番のファイルを変える前に、データと履歴を一組で検査するのに使う）
export function validateCuratedDocs({ entries, changelog, entriesRaw, changelogRaw, entriesRel = 'data/curated/entries.json', changelogRel = 'data/curated/changelog.json' }) {
  const errors = [];
  if (!isObj(entries)) return [`${entriesRel}: 先頭はオブジェクト`];
  for (const k of Object.keys(entries)) if (!['schemaVersion', 'reviewedAt', 'items'].includes(k)) errors.push(`${entriesRel}.${k}: 定義されていない項目名`);
  if (entries.schemaVersion !== 2) errors.push(`${entriesRel}: schemaVersion は 2`);
  if (!isValidDate(entries.reviewedAt) || !notFutureJst(entries.reviewedAt)) errors.push(`${entriesRel}: reviewedAt（全体の最終確認日）が必須。未来日は不可`);
  // 決まった書式（インデント2・\u エスケープなし・キー重複なし）であること。見た目と中身のずれを防ぐ
  for (const [rel, doc, raw] of [[entriesRel, entries, entriesRaw], [changelogRel, changelog, changelogRaw]]) {
    if (raw !== JSON.stringify(doc, null, 2) + '\n') errors.push(`${rel}: 決まった書式ではありません（インデント2、\\u エスケープ・重複キー・末尾の空白なし）。整形ツールで整えてください`);
  }
  errors.push(...validateItems(entries.items, { curated: true }).map((e) => `${entriesRel} ${e}`));
  const ids = Array.isArray(entries.items) ? entries.items.map((x) => x?.id).filter(Boolean) : [];
  errors.push(...validateChangelog(changelog, ids, changelogRel));
  return errors;
}

// 国・分野別の相談先リンク集（運用者だけが管理する参照データ）の検査
const DIR_TEXT = (o, path, errors, max) => {
  if (!isObj(o)) return errors.push(`${path}: {"ja","jaKana","en"} の形式が必要`);
  const keys = Object.keys(o).sort().join(',');
  if (keys !== 'en,ja,jaKana') errors.push(`${path}: キーは ja / jaKana / en の3つ（すべて必須）`);
  for (const k of ['ja', 'jaKana', 'en']) {
    const s = o[k];
    if (typeof s !== 'string' || !s.trim()) errors.push(`${path}.${k}: 空でない文字列が必要`);
    else if ([...s].length > max) errors.push(`${path}.${k}: ${max}文字以内`);
  }
  // ひらがな表示用の文に漢字が残っていないか
  if (typeof o.jaKana === 'string' && /\p{Script=Han}/u.test(o.jaKana)) errors.push(`${path}.jaKana: 漢字が含まれている（ひらがな・カタカナで書く）`);
};

export const DIR_ROLES = ['health-ministry', 'welfare-ministry', 'cert', 'public-health-institute', 'research', 'crisis-line'];

export function validateDirectory(rel) {
  const doc = readData(rel);
  const raw = readFileSync(resolve(DATA_ROOT, rel), 'utf8');
  const errors = validateDirectoryDoc(doc, rel);
  if (raw !== JSON.stringify(doc, null, 2) + '\n') errors.push(`${rel} 決まった書式（インデント2・\\uエスケープなし・末尾改行）で保存されていない`);
  return errors;
}

export function validateDirectoryDoc(doc, rel = 'directory') {
  const errors = [];
  if (!isObj(doc) || doc.schemaVersion !== 2) return [`${rel}: schemaVersion 2 が必要`];
  for (const k of Object.keys(doc)) if (!['schemaVersion', '_note', 'reviewedAt', 'categories', 'countries', 'international', 'social'].includes(k)) errors.push(`使えないキー: ${k}`);
  // 公的機関の X（旧Twitter）公式アカウント：組織のアカウントだけ。URL は https://x.com/<英数字と_> の形に限る
  if (doc.social !== undefined) {
    if (!isObj(doc.social)) errors.push('social: オブジェクトが必要');
    else
      for (const [cid, list] of Object.entries(doc.social)) {
        if (cid !== 'INTL' && !COUNTRY_IDS.has(cid)) errors.push(`social.${cid}: 国コードが不正`);
        if (!Array.isArray(list) || list.length > 15) {
          errors.push(`social.${cid}: 15件以内の配列が必要`);
          continue;
        }
        list.forEach((a, i) => {
          const p = `social.${cid}[${i}]`;
          for (const k of Object.keys(a || {})) if (!['id', 'org', 'url', 'layers'].includes(k)) errors.push(`${p}.${k}: 使えないキー`);
          if (!ID.test(a?.id || '')) errors.push(`${p}.id: 不正`);
          DIR_TEXT(a?.org, `${p}.org`, errors, 80);
          if (!/^https:\/\/x\.com\/[A-Za-z0-9_]{1,15}$/.test(a?.url || '')) errors.push(`${p}.url: https://x.com/<アカウント名> の形だけ`);
          if (!Array.isArray(a?.layers) || !a.layers.length || !a.layers.every((l) => DIR_LAYER_IDS.includes(l))) errors.push(`${p}.layers: 分野名の配列が必要`);
        });
      }
  }
  if (!isValidDate(doc.reviewedAt) || !notFutureJst(doc.reviewedAt)) errors.push('reviewedAt: 正しい日付が必要');
  const cats = new Set();
  if (!Array.isArray(doc.categories)) errors.push('categories: 配列が必要');
  else
    doc.categories.forEach((c, i) => {
      if (!isObj(c) || !/^[a-z]{2,20}$/.test(c.id) || cats.has(c.id)) errors.push(`categories[${i}].id: 英小文字の重複しないIDが必要`);
      cats.add(c?.id);
      DIR_TEXT({ ja: c?.ja, jaKana: c?.jaKana, en: c?.en }, `categories[${i}]`, errors, 40);
      for (const k of Object.keys(c || {})) if (!['id', 'ja', 'jaKana', 'en'].includes(k)) errors.push(`categories[${i}].${k}: 使えないキー`);
    });
  const ids = new Set();
  const checkBlock = (block, path) => {
    if (!isObj(block)) return errors.push(`${path}: オブジェクトが必要`);
    for (const [layer, links] of Object.entries(block)) {
      if (!DIR_LAYER_IDS.includes(layer)) errors.push(`${path}.${layer}: 分野名が不正`);
      if (!Array.isArray(links)) {
        errors.push(`${path}.${layer}: 配列が必要`);
        continue;
      }
      if (links.length > 30) errors.push(`${path}.${layer}: 30件以内`);
      links.forEach((l, i) => {
        const p = `${path}.${layer}[${i}]`;
        if (!isObj(l)) return errors.push(`${p}: オブジェクトが必要`);
        for (const k of Object.keys(l)) if (!['id', 'cat', 'role', 'name', 'desc', 'url', 'pageLang'].includes(k)) errors.push(`${p}.${k}: 使えないキー`);
        if (l.role !== undefined && !DIR_ROLES.includes(l.role)) errors.push(`${p}.role: ${DIR_ROLES.join(' / ')} のいずれか`);
        if (l.pageLang !== undefined && !(Array.isArray(l.pageLang) && l.pageLang.length <= 3 && l.pageLang.every((x) => /^[a-z]{2}$/.test(x)))) errors.push(`${p}.pageLang: 2文字の言語コードの配列（3つまで）`);
        if (!ID.test(l.id || '') || ids.has(l.id)) errors.push(`${p}.id: 英小文字・数字・ハイフンの重複しないIDが必要`);
        ids.add(l.id);
        if (layer === 'welfare') {
          if (!cats.has(l.cat)) errors.push(`${p}.cat: categories にある困りごと分類が必要`);
        } else if (l.cat !== undefined) errors.push(`${p}.cat: 福祉以外では使わない`);
        DIR_TEXT(l.name, `${p}.name`, errors, 80);
        // 説明文は、役割（role）があれば共通の説明を使い、なければ個別の desc が必須
        if (l.desc !== undefined || !l.role) DIR_TEXT(l.desc, `${p}.desc`, errors, 160);
        if (!isDirectoryUrl(l.url)) errors.push(`${p}.url: 許可リスト（directoryHosts）にない、または https 以外・?や#つきのURL`);
      });
    }
  };
  if (!isObj(doc.countries)) errors.push('countries: オブジェクトが必要');
  else
    for (const [cid, block] of Object.entries(doc.countries)) {
      if (!COUNTRY_IDS.has(cid)) errors.push(`countries.${cid}: 国コードが不正`);
      checkBlock(block, `countries.${cid}`);
    }
  checkBlock(doc.international, 'international');
  walkStrings(doc, rel, errors, { curated: true, maxLen: 400 });
  return errors.map((e) => (e.startsWith(rel) ? e : `${rel} ${e}`));
}

// 日本の47都道府県の福祉ページ（data/directory/prefectures.json）
export function validatePrefectures(rel = 'data/directory/prefectures.json') {
  const errors = [];
  const doc = readData(rel);
  if (!isObj(doc) || doc.schemaVersion !== 1 || !Array.isArray(doc.prefectures)) return [`${rel}: 形式が不正`];
  if (doc.prefectures.length !== 47) errors.push(`${rel}: 47都道府県すべてを並べる（${doc.prefectures.length}件）`);
  const ids = new Set();
  doc.prefectures.forEach((p, i) => {
    const at = `${rel} prefectures[${i}]`;
    if (p.code !== String(i + 1).padStart(2, '0')) errors.push(`${at}: code は 01〜47 の順番`);
    for (const k of Object.keys(p)) if (!['code', 'ja', 'en', 'links'].includes(k)) errors.push(`${at}.${k}: 使えないキー`);
    if (typeof p.ja !== 'string' || !/^[\p{Script=Han}\p{Script=Hiragana}]{2,5}$/u.test(p.ja)) errors.push(`${at}.ja: 都道府県名が不正`);
    if (typeof p.en !== 'string' || !/^[A-Za-z ]{4,40}$/.test(p.en)) errors.push(`${at}.en: 英語名が不正`);
    if (!Array.isArray(p.links) || p.links.length > 3) return errors.push(`${at}.links: 0〜3件の配列`);
    p.links.forEach((l, j) => {
      const lp = `${at}.links[${j}]`;
      for (const k of Object.keys(l)) if (!['id', 'role', 'title', 'url'].includes(k)) errors.push(`${lp}.${k}: 使えないキー`);
      if (l.id !== `jp-pref-${p.code}-${l.role}`) errors.push(`${lp}.id は jp-pref-<code>-<role>`);
      if (ids.has(l.id)) errors.push(`${lp}: id が重複`);
      ids.add(l.id);
      if (!['main', 'consult'].includes(l.role)) errors.push(`${lp}.role は main / consult`);
      checkText(l.title, `${lp}.title`, errors, { need: ['ja', 'en'], max: 90 });
      if (!isDirectoryUrl(l.url) || /\.pdf$/i.test(l.url)) errors.push(`${lp}.url: 許可リスト外・https でない・?や#・PDF`);
      // その都道府県自身の公式ドメインであること（例：北海道→pref.hokkaido、東京都→metro.tokyo）
      else {
        const host = new URL(l.url).hostname;
        const key = p.code === '13' ? 'metro.tokyo' : `pref.${p.en.split(' ')[0].toLowerCase()}`;
        if (!(host.includes(`${key}.lg.jp`) || host.endsWith(`${key}.jp`))) errors.push(`${lp}.url: ${p.ja}の公式ドメイン（${key}）ではない`);
      }
    });
  });
  walkStrings(doc, rel, errors, { curated: true, maxLen: 400 });
  return errors;
}

// 「今日の動物たち」の豆知識（data/curated/animals.json）
// やさしい話だけを載せるため、悲しい・怖い話につながる言葉は機械的に止める（最後は運用者が読んで判断する）
const ANIMAL_SAD = /(死|殺|絶滅|狩|捕食|食べられ|密猟|病気|感染|けが|負傷|虐待|駆除|危機|減少|脅威|death|dead|\bdie[sd]?\b|dying|kill|hunt|poach|extinct|endanger|threat|prey|disease|injur|cull|declin)/i;
const ANIMAL_KEYS = new Set(['id', 'country', 'animal', 'text', 'source', 'checkedAt']);
export function validateAnimals(rel = 'data/curated/animals.json') {
  const errors = [];
  const doc = readData(rel);
  if (!isObj(doc) || doc.schemaVersion !== 1 || !Array.isArray(doc.facts)) return [`${rel}: 形式が不正（schemaVersion 1 と facts 配列）`];
  if (!isValidDate(doc.reviewedAt) || !notFutureJst(doc.reviewedAt)) errors.push(`${rel}: reviewedAt が不正`);
  if (doc.facts.length < 30) errors.push(`${rel}: 豆知識は30件以上必要（毎日入れ替えるため）`);
  const ids = new Set();
  doc.facts.forEach((f, i) => {
    const p = `${rel} facts[${i}]${typeof f?.id === 'string' ? '(' + f.id + ')' : ''}`;
    if (!isObj(f)) return errors.push(`${p}: オブジェクトではない`);
    for (const k of Object.keys(f)) if (!ANIMAL_KEYS.has(k)) errors.push(`${p}.${k}: 使えないキー`);
    if (typeof f.id !== 'string' || !/^animal-[a-z0-9-]{3,70}$/.test(f.id)) errors.push(`${p}: id は animal- で始まる英小文字・数字・ハイフン`);
    if (ids.has(f.id)) errors.push(`${p}: id が重複`);
    ids.add(f.id);
    if (!COUNTRY_IDS.has(f.country)) errors.push(`${p}: 国コード ${f.country} が索引にない`);
    checkText(f.animal, `${p}.animal`, errors, { need: ['ja', 'en'], max: 40 });
    checkText(f.text, `${p}.text`, errors, { need: ['ja', 'en'], max: 170 });
    if (typeof f.text?.ja === 'string' && f.text.ja.length > 90) errors.push(`${p}.text.ja: 90文字以内`);
    for (const s of [f.text?.ja, f.text?.en, f.animal?.ja, f.animal?.en]) if (typeof s === 'string' && ANIMAL_SAD.test(s)) errors.push(`${p}: 癒しのコーナーに合わない言葉（死・狩り・絶滅・病気など）が含まれている`);
    if (!isObj(f.source) || typeof f.source.name !== 'string' || !f.source.name.trim() || Object.keys(f.source).some((k) => !['name', 'url'].includes(k))) errors.push(`${p}.source: name と url が必要`);
    else if (!isAnimalUrl(f.source.url)) errors.push(`${p}.source.url: 許可リスト（animalHosts）外・https でない・?や#を含む`);
    if (!isValidDate(f.checkedAt) || !notFutureJst(f.checkedAt)) errors.push(`${p}.checkedAt が不正`);
  });
  walkStrings(doc.facts, rel, errors, { curated: true, maxLen: 400 });
  return errors;
}

// リンク集の確認記録（evidence.json）：すべてのリンクに記録があり、URLが一致し、方法が決まった値であること
const METHODS = new Set(['fetched', 'operator', 'linked-from', 'unrecorded', 'unverified']);
export function validateEvidence(linksRel = 'data/directory/links.json', evRel = 'data/directory/evidence.json') {
  const errors = [];
  const doc = readData(linksRel);
  const ev = readData(evRel).links || {};
  const ids = new Set();
  const prefs = readData('data/directory/prefectures.json').prefectures || [];
  const blocks = [...Object.values(doc.countries || {}), doc.international || {}, doc.social || {}, { prefectures: prefs.flatMap((p) => p.links || []) }];
  for (const block of blocks)
    for (const links of Object.values(block))
      for (const l of links) {
        ids.add(l.id);
        const e = ev[l.id];
        if (!e) errors.push(`${evRel}: ${l.id} の確認記録が無い（無い場合は method を unrecorded にして追加する）`);
        else {
          if (e.url !== l.url) errors.push(`${evRel}: ${l.id} のURLがリンク集と一致しない`);
          if (!METHODS.has(e.method)) errors.push(`${evRel}: ${l.id} の method が不正`);
          if ((e.method === 'fetched' || e.method === 'operator') && !(isValidDate(e.checkedAt) && notFutureJst(e.checkedAt))) errors.push(`${evRel}: ${l.id} の checkedAt が不正`);
        }
      }
  for (const id of Object.keys(ev)) if (!ids.has(id)) errors.push(`${evRel}: ${id} はリンク集に無い（記録を消す）`);
  for (const e of Object.values(ev)) for (const label of scanText(JSON.stringify(e))) errors.push(`${evRel}: ${label}の疑い`);
  return errors;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const errors = [
    ...validateAnimals(),
    ...validatePrefectures(),
    ...validateEvidence(),
    ...validateCuratedPair('data/curated/entries.json', 'data/curated/changelog.json'),
    ...validateDirectory('data/directory/links.json'),
  ];
  if (errors.length) {
    console.error(`検査失敗: ${errors.length}件`);
    for (const e of errors.slice(0, 80)) console.error(' - ' + e);
    process.exit(1);
  }
  console.log('検査OK: 本番2ファイル＋相談先リンク集');
}
