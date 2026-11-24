// 表示データの検査。1件でも違反があれば失敗（終了コード1）にして、公開・マージを止める。
// 使い方: node scripts/validate-data.mjs   … data/curated（本番の2ファイル）と相談先リンク集を検査
// build.mjs からも validateItems() を呼び、自動取得分も同じ基準で検査する。

import { pathToFileURL } from 'node:url';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { scanText } from './check-privacy.mjs';
import { emergencyUrls } from './lib/health-checks.mjs';
import { DATA_ROOT, readCode, readData, isAllowedUrl, isDirectoryUrl, isAnimalUrl, looksLikeHtml, isValidDate, findForbidden, findAttackDetail, hasInvisible, hasMixedScript, notFutureJst, siWithoutExplanation, mentionsSuperIntelligence } from './lib/safety.mjs';

export const LAYERS = ['outbreak', 'research', 'mental', 'welfare', 'security', 'crime', 'disaster', 'quake'];
export const CURATED_LAYERS = ['research', 'mental', 'welfare', 'crime', 'disaster'];
// 相談先リンク集・公式Xアカウントで使える分野（防犯・防災はリンク集を表示しないため含めない。site/js/data.js の DIR_LAYERS と合わせる）
const DIR_LAYER_IDS = ['outbreak', 'research', 'mental', 'welfare', 'security', 'safety']; // safety：防災・防犯の、その国の公的機関の案内（2026-10-28 追加）
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
const ITEM_KEYS = new Set(['id', 'layer', 'title', 'summary', 'attribution', 'tags', 'topic', 'countries', 'placeBasis', 'importance', 'publishedAt', 'checkedAt', 'source', 'sourceType', 'nature', 'links']);
// 情報の性質（画面の「情報の確かさ」の表示。site/js/nature.js と合わせる）。手動掲載で、公的機関・国際機関の発表のときだけ書ける。
// 書かないときは、研究（査読論文）・開発元の発表・公式発表のどれかを sourceType から決める（地震は速報値、自動取得は公式発表の見出し）
//   statistics … 公的な統計（調査・集計の結果）／ estimate … 試算・推計（一定の前提での計算）／ preliminary … 速報値・暫定値（まとめた時点の値）／ official … 公式発表
export const NATURES = ['official', 'statistics', 'estimate', 'preliminary'];
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

    if (!curated && it.nature !== undefined) errors.push(`${p}: nature は手動掲載だけ`);
    if (curated) {
      // 「SI」だけの表記は意味が分からないため、説明を添える（リンク集の SI-CERT などの固有名は対象外）
      for (const [k, obj] of [['title', it.title], ['summary', it.summary], ['attribution', it.attribution]])
        for (const lang of ['ja', 'en']) if (typeof obj?.[lang] === 'string' && siWithoutExplanation(obj[lang])) errors.push(`${p}.${k}.${lang}: 「SI」だけでは意味が分からないため、「SI（Super Intelligence。米国政府の文書でのAIの呼び方）」のように説明を添える（ops/CURATION.md）`);
      // SI（Super Intelligence）と書かれた AI 関連の情報は、AI の情報として「ai」の印を付ける
      if (mentionsSuperIntelligence(JSON.stringify([it.title, it.summary, it.attribution])) && !(it.tags || []).includes('ai')) errors.push(`${p}: SI（Super Intelligence）の情報は AI 関連として tags に ai を付ける`);
      if (!SOURCE_TYPES.includes(it.sourceType)) errors.push(`${p}: sourceType は peer_reviewed / public_agency / intl_org / vendor`);
      else if (it.sourceType === 'vendor' && it.layer !== 'research') errors.push(`${p}: 開発元の発表（vendor）は「研究と対策」の分野だけ`);
      if (it.nature !== undefined) {
        if (!NATURES.includes(it.nature)) errors.push(`${p}: nature は ${NATURES.join(' / ')} のいずれか`);
        else if (!['public_agency', 'intl_org'].includes(it.sourceType)) errors.push(`${p}: nature は公的機関・国際機関の発表（public_agency / intl_org）のときだけ書ける（論文・開発元の発表は sourceType で表示が決まる）`);
      }
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
  // 同じ原典（source.url）の項目を重ねて載せない（2026-11 に同じ統計を2件載せた反省）。続報は topic と supersede で扱う
  const seenUrl = new Map();
  for (const it of Array.isArray(entries.items) ? entries.items : []) {
    const u = it?.source?.url;
    if (typeof u !== 'string') continue;
    if (seenUrl.has(u)) errors.push(`${entriesRel}: ${it.id} の原典が ${seenUrl.get(u)} と同じ（重複掲載のおそれ）`);
    else seenUrl.set(u, it.id);
  }
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
    for (const k of Object.keys(p)) if (!['code', 'ja', 'en', 'links', 'local'].includes(k)) errors.push(`${at}.${k}: 使えないキー`);
    // 市区町村・社会福祉協議会の福祉の相談ページ（2026-11 追加。運用者の決定で、市区町村の公式サイトと社会福祉協議会まで）
    if (p.local !== undefined) {
      if (!Array.isArray(p.local) || p.local.length > 30) errors.push(`${at}.local: 0〜30件の配列`);
      else
        p.local.forEach((l, j) => {
          const lp = `${at}.local[${j}]`;
          if (!isObj(l)) return errors.push(`${lp}: オブジェクトが必要`);
          for (const k of Object.keys(l)) if (!['id', 'kind', 'name', 'nameKana', 'title', 'url'].includes(k)) errors.push(`${lp}.${k}: 使えないキー`);
          if (typeof l.id !== 'string' || !new RegExp(`^jp-local-${p.code}-[a-z0-9][a-z0-9-]{1,60}$`).test(l.id)) errors.push(`${lp}.id は jp-local-${p.code}-<英小文字>`);
          if (ids.has(l.id)) errors.push(`${lp}: id が重複`);
          ids.add(l.id);
          if (!['city', 'shakyo'].includes(l.kind)) errors.push(`${lp}.kind は city（市区町村）/ shakyo（社会福祉協議会）`);
          checkText(l.name, `${lp}.name`, errors, { need: ['ja', 'en'], max: 60 });
          if (typeof l.nameKana !== 'string' || !/^[\u3041-\u309f\u30fc ]{2,40}$/.test(l.nameKana)) errors.push(`${lp}.nameKana はひらがなで（ひらがな表示に使う）`);
          checkText(l.title, `${lp}.title`, errors, { need: ['ja', 'en'], max: 90 });
          if (l.kind === 'shakyo' && typeof l.name?.ja === 'string' && !l.name.ja.endsWith('社会福祉協議会')) errors.push(`${lp}.name.ja: 社会福祉協議会の名前で終わること`);
          if (!isDirectoryUrl(l.url) || /\.pdf$/i.test(l.url)) errors.push(`${lp}.url: 許可リスト外・https でない・?や#・PDF`);
          // 市区町村は、市区町村の公式ドメイン（city.〜.jp・〜.lg.jp）であること
          else if (l.kind === 'city' && !/(^|\.)city\.[a-z0-9.-]+\.jp$|\.lg\.jp$/.test(new URL(l.url).hostname)) errors.push(`${lp}.url: 市区町村の公式ドメイン（city.〜.jp・〜.lg.jp）ではない`);
        });
    }
    if (typeof p.ja !== 'string' || !/^[\p{Script=Han}\p{Script=Hiragana}]{2,5}$/u.test(p.ja)) errors.push(`${at}.ja: 都道府県名が不正`);
    if (typeof p.en !== 'string' || !/^[A-Za-z ]{4,40}$/.test(p.en)) errors.push(`${at}.en: 英語名が不正`);
    if (!Array.isArray(p.links) || p.links.length > 4) return errors.push(`${at}.links: 0〜4件の配列`);
    p.links.forEach((l, j) => {
      const lp = `${at}.links[${j}]`;
      for (const k of Object.keys(l)) if (!['id', 'role', 'title', 'url'].includes(k)) errors.push(`${lp}.${k}: 使えないキー`);
      if (l.id !== `jp-pref-${p.code}-${l.role}`) errors.push(`${lp}.id は jp-pref-<code>-<role>`);
      if (ids.has(l.id)) errors.push(`${lp}: id が重複`);
      ids.add(l.id);
      // main・consult：暮らし・仕事の相談、mind：こころの健康（精神保健福祉センターなど）
      // bousai：その都道府県の防災・災害の情報のページ（2026-11 追加）
      if (!['main', 'consult', 'mind', 'bousai'].includes(l.role)) errors.push(`${lp}.role は main / consult / mind / bousai`);
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

// 「つながりを見る」ページのテーマ（data/curated/connections.json。運用者だけが管理する）
// 手動で選んだ「同じテーマの情報」の組み合わせ。情報どうしの因果関係は示さない（原因・結果を言う言葉は機械的に止める）
// 国の基本情報（首都・言語・通貨・政体・議会）と政府観光局（2026-11-24 追加）：事実だけ。評価や印象の言葉は入れない
const PROFILE_FIELDS = ['language', 'government', 'legislature']; // 首都は、都市国家など外務省の記載が無い国では省く
const PROFILE_OPINION = /(独裁的|民主的でない|危険な国|治安が悪い|すばらしい|美しい国|おすすめ|人気|有名な|親日|反日|friendly|dangerous|beautiful|recommended|popular|famous|corrupt|authoritarian regime)/i;
export function validateCountryProfiles(rel = 'data/curated/country-profiles.json') {
  const errors = [];
  if (!existsSync(resolve(DATA_ROOT, rel))) return errors;
  let doc;
  try {
    doc = readData(rel);
  } catch (e) {
    return [`${rel}: JSON として読めない（${e.message}）`];
  }
  if (!isObj(doc) || !isObj(doc.countries) || !isValidDate(doc.reviewedAt)) return [`${rel}: 形が違う（countries・reviewedAt が必要）`];
  const txt = (o, path) => {
    if (!isObj(o)) return errors.push(`${rel}: ${path} がない`);
    for (const l of ['ja', 'en']) {
      const v = o[l];
      if (typeof v !== 'string' || !v.trim() || v.length > 160 || looksLikeHtml(v) || hasInvisible(v)) errors.push(`${rel}: ${path}.${l} が不正`);
      else if (PROFILE_OPINION.test(v)) errors.push(`${rel}: ${path}.${l} に評価や印象の言葉がある（事実だけを書く）`);
    }
  };
  for (const [id, c] of Object.entries(doc.countries)) {
    if (!COUNTRY_IDS.has(id)) errors.push(`${rel}: 地図に無い国（${id}）`);
    if (!isObj(c)) {
      errors.push(`${rel}: ${id} の形が違う`);
      continue;
    }
    for (const f of PROFILE_FIELDS) txt(c[f], `${id}.${f}`);
    if (c.capital !== undefined) txt(c.capital, `${id}.capital`);
    txt(c.currency, `${id}.currency`);
    if (!/^[A-Z]{3}$/.test(c.currency?.code || '')) errors.push(`${rel}: ${id}.currency.code は ISO 4217 の3文字`);
    if (!/^https:\/\/www\.mofa\.go\.jp\/mofaj\/area\/[a-z_]+\/data\.html$/.test(c.mofa?.url || '') || !isValidDate(c.mofa?.updated)) errors.push(`${rel}: ${id}.mofa は外務省の基礎データのページと、その更新日`);
    if (c.tourism !== undefined) {
      txt(c.tourism.name, `${id}.tourism.name`);
      if (!isAllowedUrl(c.tourism.url || '')) errors.push(`${rel}: ${id}.tourism.url が許可リストに無い（${c.tourism.url}）`);
    }
    if (c.whc !== undefined && !/^[a-z]{2}$/.test(c.whc)) errors.push(`${rel}: ${id}.whc はユネスコの2文字の国コード`);
  }
  return errors;
}

const CONNECTION_CAUSAL = /(原因|引き起こ|のせいで|によって生じ|結果として|もたらし|因果|caus|lead(?:s|ing)? to|led to|because of|result(?:s|ed)? in|due to|trigger)/i;
const CONNECTION_KEYS = new Set(['id', 'title', 'summary', 'note', 'items']);
export function validateConnections(rel = 'data/curated/connections.json', entriesRel = 'data/curated/entries.json') {
  const errors = [];
  let doc, raw, entries;
  // ファイルが無いときは検査しない（作る前の版との取り込みの順番のため。ページの組み立て（build.mjs）は、無ければ失敗する）
  if (!existsSync(resolve(DATA_ROOT, rel))) return errors;
  try {
    raw = readFileSync(resolve(DATA_ROOT, rel), 'utf8');
    doc = readData(rel);
    entries = readData(entriesRel);
  } catch (e) {
    return [`${rel}: JSONとして読めない（${e.message}）`];
  }
  return validateConnectionsDoc(doc, raw, new Set((entries?.items || []).map((x) => x?.id)), rel);
}
export function validateConnectionsDoc(doc, raw, entryIds, rel = 'connections') {
  const errors = [];
  if (!isObj(doc)) return [`${rel}: 先頭はオブジェクト`];
  for (const k of Object.keys(doc)) if (!['schemaVersion', 'reviewedAt', 'themes'].includes(k)) errors.push(`${rel}.${k}: 定義されていない項目名`);
  if (doc.schemaVersion !== 1) errors.push(`${rel}: schemaVersion は 1`);
  if (!isValidDate(doc.reviewedAt) || !notFutureJst(doc.reviewedAt)) errors.push(`${rel}: reviewedAt が不正、または未来日`);
  if (raw !== undefined && raw !== JSON.stringify(doc, null, 2) + '\n') errors.push(`${rel}: 決まった書式ではありません（インデント2、\\u エスケープ・重複キー・末尾の空白なし）`);
  if (!Array.isArray(doc.themes) || doc.themes.length < 1 || doc.themes.length > 30) return [...errors, `${rel}: themes は1〜30件の配列`];
  const ids = new Set();
  doc.themes.forEach((th, i) => {
    const p = `${rel}.themes[${i}]${typeof th?.id === 'string' ? '(' + th.id + ')' : ''}`;
    if (!isObj(th)) return errors.push(`${p}: オブジェクトが必要`);
    for (const k of Object.keys(th)) if (!CONNECTION_KEYS.has(k)) errors.push(`${p}.${k}: 定義されていない項目名`);
    if (typeof th.id !== 'string' || !TOPIC.test(th.id)) errors.push(`${p}: id は英小文字・数字・ハイフン`);
    if (ids.has(th.id)) errors.push(`${p}: id が重複`);
    ids.add(th.id);
    walkStrings(Object.fromEntries(['title', 'summary', 'note'].filter((k) => th[k] !== undefined).map((k) => [k, th[k]])), p, errors, { curated: true, maxLen: 200 });
    checkText(th.title, `${p}.title`, errors, { need: ['ja', 'en'], max: 60 });
    checkText(th.summary, `${p}.summary`, errors, { need: ['ja', 'en'], max: 200 });
    if (th.note !== undefined) checkText(th.note, `${p}.note`, errors, { need: ['ja', 'en'], max: 200 });
    for (const s of [th.title?.ja, th.title?.en, th.summary?.ja, th.summary?.en, th.note?.ja, th.note?.en])
      if (typeof s === 'string' && CONNECTION_CAUSAL.test(s)) errors.push(`${p}: 因果関係（原因・結果）を言う言葉は使わない。同じテーマで並べるだけにする`);
    if (!Array.isArray(th.items) || th.items.length < 2 || th.items.length > 12) errors.push(`${p}: items は2〜12件の id の配列`);
    else {
      if (new Set(th.items).size !== th.items.length) errors.push(`${p}: items に重複`);
      for (const x of th.items) if (typeof x !== 'string' || !entryIds.has(x)) errors.push(`${p}: ${x} は掲載中の手動掲載の項目に無い`);
    }
  });
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
  const blocks = [...Object.values(doc.countries || {}), doc.international || {}, doc.social || {}, { prefectures: prefs.flatMap((p) => p.links || []), local: prefs.flatMap((p) => p.local || []) }];
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

// このサイトの安全対策の記録（data/curated/security-log.json。運用者だけが変更する。更新一覧のページの「セキュリティ対策」に表示）
// リンクは、公的機関などの許可リストか、scripts/allowed-sources.json の securityLogHosts（GitHub・Node.js の公式）のホストだけ
const SEC_KINDS = new Set(['incident', 'fix', 'audit', 'policy']);
const SEC_STATUS = new Set(['done', 'operator-check', 'proposed']);
const SEC_KEYS = new Set(['date', 'kind', 'status', 'title', 'summary', 'impact', 'sources']);
export function isSecurityLogUrl(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' || u.username || u.password || u.port || u.search || u.hash) return false;
  const hosts = readCode('scripts/allowed-sources.json').securityLogHosts || [];
  return isAllowedUrl(url) || hosts.includes(u.hostname);
}
export function validateSecurityLogDoc(doc, rel = 'security-log') {
  const errors = [];
  if (!isObj(doc) || doc.schemaVersion !== 1 || !Array.isArray(doc.entries)) return [`${rel}: schemaVersion 1 と entries の配列が必要`];
  if (doc.entries.length > 500) errors.push(`${rel}: 記録が多すぎる（500件まで）`);
  doc.entries.forEach((e, i) => {
    const p = `${rel} entries[${i}]`;
    if (!isObj(e)) return errors.push(`${p}: オブジェクトが必要`);
    for (const k of Object.keys(e)) if (!SEC_KEYS.has(k)) errors.push(`${p}.${k}: 定義されていない項目名`);
    if (!(isValidDate(e.date) && notFutureJst(e.date))) errors.push(`${p}.date: YYYY-MM-DD の過去の日付が必要`);
    if (!SEC_KINDS.has(e.kind)) errors.push(`${p}.kind: ${[...SEC_KINDS].join(' / ')} のどれか`);
    if (!SEC_STATUS.has(e.status)) errors.push(`${p}.status: ${[...SEC_STATUS].join(' / ')} のどれか`);
    checkText(e.title, `${p}.title`, errors, { need: ['ja', 'en'], max: 120 });
    checkText(e.summary, `${p}.summary`, errors, { need: ['ja', 'en'], max: 400 });
    if (e.impact !== undefined) checkText(e.impact, `${p}.impact`, errors, { need: ['ja', 'en'], max: 400 });
    if (!Array.isArray(e.sources) || e.sources.length > 5) errors.push(`${p}.sources: 5件までの配列が必要`);
    else
      e.sources.forEach((s, j) => {
        if (!isObj(s) || typeof s.name !== 'string' || !s.name.trim()) return errors.push(`${p}.sources[${j}]: name が必要`);
        for (const k of Object.keys(s)) if (!['name', 'url'].includes(k)) errors.push(`${p}.sources[${j}].${k}: 定義されていない項目名`);
        if (s.url !== undefined && !(typeof s.url === 'string' && isSecurityLogUrl(s.url))) errors.push(`${p}.sources[${j}].url: 許可リスト（公的機関など・securityLogHosts）の https の URL だけ（? や # なし）`);
      });
    walkStrings({ title: e.title, summary: e.summary, ...(e.impact !== undefined ? { impact: e.impact } : {}), sources: e.sources }, p, errors, { curated: true, maxLen: 400 });
  });
  for (let i = 1; i < doc.entries.length; i++) if (doc.entries[i].date < doc.entries[i - 1].date) errors.push(`${rel}: 記録は日付の古い順に並べ、新しい記録は末尾に足す（entries[${i}]）`);
  return errors;
}
export function validateSecurityLog(rel = 'data/curated/security-log.json') {
  return validateSecurityLogDoc(readData(rel), rel);
}

// 急な病気・けがのときの検索（data/curated/health-guide.json。運用者だけが変更する。emergency-care.html の検索で使う）
// リンクは公的機関の許可リスト（linkHosts・directoryHosts）の https だけ。説明は公式ページの要点を短くまとめたもので、診断の代わりにしない
const HEALTH_KINDS = new Set(['symptom', 'disease', 'firstaid', 'search']);
const HEALTH_AUD = new Set(['general', 'care']);
const HEALTH_KEYS = new Set(['id', 'kind', 'audience', 'name', 'kana', 'aliases', 'urgent', 'summary', 'summaryKana', 'links']);
const KANA = /^[\u3041-\u309f\u30fc・（）()、\s]+$/u;
export function validateHealthGuideDoc(doc, rel = 'health-guide') {
  const errors = [];
  if (!isObj(doc) || doc.schemaVersion !== 1 || !Array.isArray(doc.items)) return [`${rel}: schemaVersion 1 と items の配列が必要`];
  if (!isValidDate(doc.reviewedAt)) errors.push(`${rel}.reviewedAt: YYYY-MM-DD が必要`);
  if (doc.items.length > 300) errors.push(`${rel}: 300件まで`);
  const ids = new Set();
  doc.items.forEach((e, i) => {
    const p = `${rel} items[${i}]`;
    if (!isObj(e)) return errors.push(`${p}: オブジェクトが必要`);
    for (const k of Object.keys(e)) if (!HEALTH_KEYS.has(k)) errors.push(`${p}.${k}: 定義されていない項目名`);
    if (typeof e.id !== 'string' || !ID.test(e.id) || ids.has(e.id)) errors.push(`${p}.id: 英小文字・数字・ハイフンの重複しない ID が必要`);
    ids.add(e.id);
    if (!HEALTH_KINDS.has(e.kind)) errors.push(`${p}.kind: ${[...HEALTH_KINDS].join(' / ')} のどれか`);
    if (!Array.isArray(e.audience) || !e.audience.length || e.audience.some((a) => !HEALTH_AUD.has(a))) errors.push(`${p}.audience: general / care の配列`);
    if (typeof e.name !== 'string' || !e.name.trim() || e.name.length > 60) errors.push(`${p}.name: 60文字以内が必要`);
    if (typeof e.kana !== 'string' || !KANA.test(e.kana)) errors.push(`${p}.kana: ひらがなの読みが必要`);
    if (!Array.isArray(e.aliases) || e.aliases.length > 30 || e.aliases.some((a) => typeof a !== 'string' || !a.trim() || a.length > 30)) errors.push(`${p}.aliases: 30文字以内の文字列を30件まで`);
    if (typeof e.urgent !== 'boolean') errors.push(`${p}.urgent: true / false が必要`);
    // 説明文（summary）は 2026-11-24 に運用者の判断ですべて削除（症状ごとの対応の説明は書かず、公式ページへの案内だけにする）。足すときは200文字以内
    if (e.summary !== undefined && (typeof e.summary !== 'string' || !e.summary.trim() || e.summary.length > 200)) errors.push(`${p}.summary: 200文字以内の文字列`);
    // 説明文のひらがな版（「ひらがなで よむ」で表示。無くてもよい）。漢字を含まないこと
    if (e.summaryKana !== undefined && (typeof e.summaryKana !== 'string' || !e.summaryKana.trim() || e.summaryKana.length > 400 || /[\u4e00-\u9fff]/u.test(e.summaryKana))) errors.push(`${p}.summaryKana: 漢字を含まない400文字以内の文字列`);
    if (!Array.isArray(e.links) || !e.links.length || e.links.length > 4) errors.push(`${p}.links: 1〜4件の配列が必要`);
    else
      e.links.forEach((l, j) => {
        if (!isObj(l) || typeof l.name !== 'string' || !l.name.trim()) return errors.push(`${p}.links[${j}]: name が必要`);
        for (const k of Object.keys(l)) if (!['name', 'url'].includes(k)) errors.push(`${p}.links[${j}].${k}: 定義されていない項目名`);
        let ok = false;
        try {
          const u = new URL(l.url);
          // ? や # の付いた URL は、allowed-sources.json の exactQueryUrls に完全一致で書いたものだけ
          const exact = (readCode('scripts/allowed-sources.json').exactQueryUrls || []).includes(l.url);
          ok = u.protocol === 'https:' && !u.username && !u.password && !u.port && ((!u.search && !u.hash) || exact) && (isAllowedUrl(l.url) || isDirectoryUrl(exact ? l.url.split('?')[0] : l.url));
        } catch {
          ok = false;
        }
        if (!ok) errors.push(`${p}.links[${j}].url: 許可リストの公的機関の https の URL だけ（? や # なし）`);
      });
    walkStrings({ name: e.name, aliases: e.aliases, ...(e.summary !== undefined ? { summary: e.summary } : {}), links: e.links }, p, errors, { curated: true, maxLen: 200 });
  });
  return errors;
}
// 運用者が急な病気・けがのページのリンクを確かめた日の記録（data/curated/health-checks.json）
export function validateHealthChecksDoc(doc, known, rel = 'health-checks') {
  const errors = [];
  if (!isObj(doc) || doc.schemaVersion !== 1 || !isObj(doc.checks)) return [`${rel}: schemaVersion 1 と checks のオブジェクトが必要`];
  for (const k of Object.keys(doc)) if (!['schemaVersion', '_note', 'checks'].includes(k)) errors.push(`${rel}.${k}: 定義されていない項目名`);
  for (const [url, d] of Object.entries(doc.checks)) {
    if (!known.has(url)) errors.push(`${rel}: ${url} は急な病気・けがのページのリンクではない（記録を消す）`);
    if (!(isValidDate(d) && notFutureJst(d))) errors.push(`${rel}: ${url} の日付は YYYY-MM-DD の過去の日付が必要`);
  }
  return errors;
}
// 救急の電話相談の受付時間・番号（data/curated/er-lines.json）
export function validateErLinesDoc(doc, rel = 'er-lines') {
  const errors = [];
  if (!isObj(doc) || doc.schemaVersion !== 1 || !Array.isArray(doc.centers)) return [`${rel}: schemaVersion 1 と centers の配列が必要`];
  if (!isValidDate(doc.checkedAt)) errors.push(`${rel}.checkedAt: YYYY-MM-DD が必要`);
  if (typeof doc.operatorVerified !== 'boolean') errors.push(`${rel}.operatorVerified: true / false が必要`);
  // 照合した日（operatorVerified が true のときは必須。古くなったら本番では表示を止める）
  if (doc.verifiedAt !== undefined && doc.verifiedAt !== null && !isValidDate(doc.verifiedAt)) errors.push(`${rel}.verifiedAt: YYYY-MM-DD か null`);
  if (doc.operatorVerified === true && !isValidDate(doc.verifiedAt)) errors.push(`${rel}.verifiedAt: operatorVerified が true のときは、照合した日（YYYY-MM-DD）が必要`);
  doc.centers.forEach((c, i) => {
    const p = `${rel} centers[${i}]`;
    if (!Array.isArray(c.prefs) || !c.prefs.length || c.prefs.some((x) => !/^(0[1-9]|[1-3]\d|4[0-7])$/.test(x))) errors.push(`${p}.prefs: 都道府県コード（01〜47）の配列`);
    for (const k of ['name', 'hours', 'altNumbers']) if (typeof c[k] !== 'string' || !c[k].trim() || c[k].length > 160) errors.push(`${p}.${k}: 160文字以内が必要`);
    if (!/^[0-9０-９\-／：・区地多摩 ]+$/.test(c.altNumbers.replace(/23区|多摩地区/g, ''))) errors.push(`${p}.altNumbers: 電話番号と区切りだけ`);
    if (typeof c.note !== 'string' || c.note.length > 120) errors.push(`${p}.note: 120文字以内の文字列`);
    walkStrings({ name: c.name, hours: c.hours, note: c.note }, p, errors, { curated: true, maxLen: 160 });
  });
  return errors;
}
export function validateHealthGuide(rel = 'data/curated/health-guide.json') {
  const errors = validateHealthGuideDoc(readData(rel), rel);
  errors.push(...validateErLinesDoc(readData('data/curated/er-lines.json'), 'data/curated/er-lines.json'));
  if (!errors.length) errors.push(...validateHealthChecksDoc(readData('data/curated/health-checks.json'), emergencyUrls(), 'data/curated/health-checks.json'));
  return errors;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const errors = [
    ...validateAnimals(),
    ...validatePrefectures(),
    ...validateEvidence(),
    ...validateCuratedPair('data/curated/entries.json', 'data/curated/changelog.json'),
    ...validateConnections(),
    ...validateCountryProfiles(),
    ...validateDirectory('data/directory/links.json'),
    ...validateSecurityLog(),
    ...validateHealthGuide(),
  ];
  if (errors.length) {
    console.error(`検査失敗: ${errors.length}件`);
    for (const e of errors.slice(0, 80)) console.error(' - ' + e);
    process.exit(1);
  }
  console.log('検査OK: 本番2ファイル＋つながりのテーマ＋相談先リンク集＋安全対策の記録＋急な病気・けがの検索');
}
