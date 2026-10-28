// サイトを組み立てる。GitHub Actions でもローカルでも同じ処理。
//   node scripts/build.mjs           … 公的機関から取得して _site/ を作る（本番）
//   node scripts/build.mjs --offline … ネットに接続せず組み立てる（手動掲載の実データのみ。自動取得の分野は「未取得」と表示）
// 取得・検査のどこかで失敗したら終了コード1で止まり、_site/ は公開されない。
// その場合、公開中のサイトは前回の内容のまま残る（壊れたデータで上書きしない設計）。

import './lib/node-guard.mjs';
import { cpSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT, readData, readCode } from './lib/safety.mjs';
const { enabledFetchers } = readCode('scripts/allowed-sources.json');
import { quakeStatusOf } from './fetch-usgs.mjs';
import { validateItems, validateCuratedPair, validateDirectory, validateEvidence, validateAnimals, validatePrefectures, CURATED_LAYERS } from './validate-data.mjs';
import { pickDaily, toItems } from './lib/animals.mjs';
import { applySupersede } from './lib/supersede.mjs';
import { fitCount, RULES, MAX_BY_LAYER } from './importance-rules.mjs';
import { isShownLink } from './lib/link-shown.mjs';
import { writeSeo } from './lib/seo.mjs';

// 確認・改装中（運用者が main に ops/MAINTENANCE を置いたとき）：公的機関からの取得をせずに組み立て、トップを「確認・改装中」にする。
// 主な取得元（WHO・CISA）の障害で公開が止まっているときでも、この表示に切り替えられるようにするため（取得の失敗で止まらない）
const MAINTENANCE = existsSync(resolve(ROOT, 'ops/MAINTENANCE'));
const OFFLINE = process.argv.includes('--offline') || MAINTENANCE;
// ローカル確認用：運用者・AI が公式ページで確認した取得結果（API と同じ形の JSON）を使って組み立てる。
//   TA_SNAPSHOT_DIR=<フォルダ> TA_SNAPSHOT_AT=<確認日時ISO> node scripts/build.mjs --snapshot
// 公開（GitHub Actions）では使わない。
const SNAPSHOT = !OFFLINE && process.argv.includes('--snapshot');
const OUT = resolve(ROOT, '_site');
const now = new Date();
const DAY = 86400000;

async function loadAuto(layer) {
  if (OFFLINE) return [];
  if (SNAPSHOT) {
    const dir = process.env.TA_SNAPSHOT_DIR;
    if (!dir) throw new Error('--snapshot には TA_SNAPSHOT_DIR が必要');
    const file = resolve(dir, { outbreak: 'who-don.json', security: 'cisa-kev.json', quake: 'usgs-quakes.json' }[layer]);
    const list = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : [];
    if (layer === 'quake') return existsSync(file) ? (await import('./fetch-usgs.mjs')).inspectQuakes(list, now.getTime()) : null;
    if (layer === 'outbreak') return (await import('./fetch-who-don.mjs')).processDonList(list, now.getTime());
    const { normalizeKev } = await import('./fetch-security.mjs');
    return list.map((v) => normalizeKev(v, now.getTime())).filter(Boolean);
  }
  if (layer === 'outbreak') return (await import('./fetch-who-don.mjs')).fetchOutbreaks();
  if (layer === 'security') return (await import('./fetch-security.mjs')).fetchSecurity();
  if (layer === 'quake') return (await import('./fetch-usgs.mjs')).fetchQuakes();
  throw new Error('unknown auto layer ' + layer);
}


async function main() {
  const errors = [];
  const base = 'data/curated/entries.json';
  const logRel = 'data/curated/changelog.json';
  errors.push(...validateCuratedPair(base, logRel));
  errors.push(...validateDirectory('data/directory/links.json'));
  errors.push(...validateEvidence());
  errors.push(...validateAnimals());
  errors.push(...validatePrefectures());
  const { schemaVersion, reviewedAt, categories, countries, international, social } = readData('data/directory/links.json');
  // リンク集は「確認の記録」がある（AIが公式ページを開いて確認した fetched、または運用者が確認した operator）ものだけを公開する。
  // 記録のないもの・確認できなかったものは、確認できるまで表示しない（ops/LINK-SAFETY.md「迷ったら載せない」）
  const evidence = readData('data/directory/evidence.json').links;
  let hidden = 0;
  const shown = (block) =>
    Object.fromEntries(
      Object.entries(block).map(([layer, links]) => [
        layer,
        links.flatMap((l) => {
          if (!isShownLink(l, evidence)) return (hidden++, []);
          return [{ ...l, checkedAt: evidence[l.id].checkedAt }];
        }),
      ]),
    );
  const directory = {
    schemaVersion,
    reviewedAt,
    categories,
    countries: Object.fromEntries(Object.entries(countries).map(([id, b]) => [id, shown(b)])),
    international: shown(international),
    social: shown(social), // 公式Xアカウントも、確認の記録があるものだけ
    // 日本の都道府県の福祉ページ（福祉の探し方ページで使う）。確認の記録があるものだけ
    prefectures: readData('data/directory/prefectures.json').prefectures.map((p) => ({ ...p, links: shown({ l: p.links }).l })),
  };
  if (hidden) console.log(`リンク集：確認の記録がない ${hidden} 件は表示しない（data/directory/evidence.json）`);
  const curated = readData(base);
  const changelog = readData(logRel);

  const snapAt = SNAPSHOT && process.env.TA_SNAPSHOT_AT && !Number.isNaN(Date.parse(process.env.TA_SNAPSHOT_AT)) ? new Date(process.env.TA_SNAPSHOT_AT).toISOString() : now.toISOString();
  const auto = {};
  for (const layer of ['outbreak', 'security']) {
    auto[layer] = await loadAuto(layer);
    errors.push(...validateItems(auto[layer], { layer, curated: false }));
    if (!OFFLINE && !SNAPSHOT && auto[layer].length === 0) errors.push(`${layer}: 取得結果が0件 — 異常とみなして公開を中止`);
  }
  // 補助の自動取得（USGS の地震、公的機関の RSS の見出し）。取れなくても公開は止めない（その情報源の項目が無いだけ）。
  // 状態は、最後の検査が終わってから情報源ごとに決める：
  //   ok      … 取得でき、正しい項目が1件以上ある
  //   empty   … 取得できたが、対象の項目が0件（正常な0件）
  //   invalid … 応答に項目はあるが、検査を通った項目が0件で、異常な項目があった（壊れた応答の疑い）
  //   failed  … 通信・応答の形の異常で取得できなかった
  //   notFetched … ネットなしの確認版（スナップショットにその情報源のファイルが無いときも）
  // 取得時刻は ok と empty のときだけ付ける（失敗や全件異常を「取得成功」に見せない）
  const feeds = {}; // key -> { layer, status, raw, dropped }
  const extra = { quake: [], crime: [], disaster: [], research: [], security: [] };
  const accept = (key, layer, got, maxShown) => {
    if (!got) return (feeds[key] = { layer, status: 'notFetched', raw: 0, dropped: 0 });
    if (got.error) {
      console.log(`::warning::${key} を取得できなかった（${got.error}）`);
      return (feeds[key] = { layer, status: 'failed', raw: 0, dropped: 0 });
    }
    // 形の正しくない項目は、その項目だけ除く（1件の異常で一覧全体や公開を止めない）
    const valid = got.items.filter((it) => {
      const bad = validateItems([it], { layer, curated: false });
      if (bad.length) console.log(`::warning::${key} の項目を除外：${bad[0]}`);
      return bad.length === 0;
    });
    const dropped = got.errors + (got.items.length - valid.length);
    if (dropped) console.log(`::warning::${key} の項目のうち ${dropped} 件を異常として除外`);
    // 1つの情報源だけで分野が埋まらないよう、情報源ごとの上限（新しい順）を設ける
    extra[layer].push(...(maxShown ? valid.slice(0, maxShown) : valid));
    feeds[key] = { layer, status: quakeStatusOf({ raw: got.raw, normalized: got.items.length, errors: got.errors, valid: valid.length }), raw: got.raw, dropped };
  };
  if (enabledFetchers.usgsQuakes) {
    if (OFFLINE) accept('usgsQuakes', 'quake', null);
    else {
      let got;
      try {
        got = await loadAuto('quake');
      } catch (e) {
        got = { error: e.message };
      }
      accept('usgsQuakes', 'quake', got);
    }
  }
  {
    const { FEEDS, inspectFeed, fetchFeeds } = await import('./fetch-feeds.mjs');
    const on = FEEDS.filter((f) => enabledFetchers[f.key]);
    let results = {};
    if (SNAPSHOT) {
      // 確認版：TA_SNAPSHOT_DIR に <key>.xml があれば、それを本番と同じ処理で読む
      for (const f of on) {
        const file = resolve(process.env.TA_SNAPSHOT_DIR, `${f.key}.xml`);
        if (!existsSync(file)) continue;
        try {
          results[f.key] = inspectFeed(f, readFileSync(file, 'utf8'), now.getTime());
        } catch (e) {
          results[f.key] = { error: e.message };
        }
      }
    } else if (!OFFLINE) results = await fetchFeeds();
    for (const f of on) accept(f.key, f.layer, results[f.key] || null, f.maxShown);
  }
  // JPCERT/CC の注意喚起（ITセキュリティの補助の取得元）。失敗しても CISA の情報は残し、取得元ごとの状態を meta に残す
  if (enabledFetchers.jpcertRss) {
    const { inspectJpcertRdf, fetchJpcert } = await import('./fetch-security.mjs');
    let got = null;
    if (SNAPSHOT) {
      const file = resolve(process.env.TA_SNAPSHOT_DIR, 'jpcertRss.xml');
      if (existsSync(file))
        try {
          got = inspectJpcertRdf(readFileSync(file, 'utf8'), now.getTime());
        } catch (e) {
          got = { error: e.message };
        }
    } else if (!OFFLINE)
      try {
        got = await fetchJpcert(now.getTime());
      } catch (e) {
        got = { error: e.message };
      }
    accept('jpcertRss', 'security', got);
  }
  const fetchedAt = (layer) =>
    Object.values(feeds).some((f) => f.layer === layer && (f.status === 'ok' || f.status === 'empty')) ? (SNAPSHOT ? snapAt : now.toISOString()) : null;
  if (errors.length) {
    console.error(`検査失敗のため公開を中止: ${errors.length}件`);
    for (const e of errors.slice(0, 50)) console.error(' - ' + e);
    process.exit(1);
  }

  const layers = {
    outbreak: { kind: 'auto', retrievedAt: OFFLINE ? null : SNAPSHOT ? snapAt : now.toISOString(), items: fitCount(applySupersede(auto.outbreak, now), RULES.outbreak.keepDays, now) },
    security: { kind: 'auto', retrievedAt: OFFLINE ? null : SNAPSHOT ? (auto.security.length ? snapAt : null) : now.toISOString(), items: fitCount(applySupersede([...auto.security, ...extra.security], now), RULES.securityKev.keepDays, now) },
  };
  // 手動掲載の分野も、新しい順に最大50件（新しい情報が入ると、古いものから表示を外れる）
  const curatedOf = (...ls) => curated.items.filter((it) => ls.includes(it.layer));
  // 研究と対策：手動掲載＋CDC などの自動の見出し（自動の分は情報源ごとの上限つき）
  layers.research = { kind: Object.values(feeds).some((f) => f.layer === 'research') ? 'mixed' : 'curated', retrievedAt: fetchedAt('research'), reviewedAt: curated.reviewedAt, items: fitCount(applySupersede([...curatedOf('research'), ...extra.research], now), null, now, MAX_BY_LAYER.research ?? undefined) };
  // こころと福祉：手動掲載の「こころ」と「福祉」を一つの分野で表示する（元の分類は sub に残し、画面で小さく示す）
  layers.care = {
    kind: 'curated',
    reviewedAt: curated.reviewedAt,
    items: fitCount(applySupersede(curatedOf('mental', 'welfare'), now), null, now, MAX_BY_LAYER.care ?? undefined).map((it) => ({ ...it, layer: 'care', sub: it.layer })),
  };
  // 防犯（詐欺・闇バイトなどの注意喚起）と防災（災害の被害状況）：手動掲載＋公的機関の自動の見出し
  for (const layer of ['crime', 'disaster']) {
    const hasFeed = Object.values(feeds).some((f) => f.layer === layer);
    layers[layer] = {
      kind: hasFeed ? 'mixed' : 'curated',
      retrievedAt: fetchedAt(layer),
      reviewedAt: curated.reviewedAt,
      items: fitCount(applySupersede([...extra[layer], ...curatedOf(layer)], now), RULES[layer].keepDays, now, undefined, RULES[layer].fillDays),
    };
  }
  // 地震：USGS の自動取得だけ（専用の分野。ほかの分野の情報を押し流さない）
  layers.quake = { kind: 'auto', retrievedAt: fetchedAt('quake'), items: fitCount(applySupersede(extra.quake, now), RULES.quake.keepDays, now) };
  // 今日の動物たち：日本時間の日付で、豆知識の一覧から自動で選ぶ（1日2回の公開でも、同じ日なら同じ動物）
  const animals = readData('data/curated/animals.json');
  const todayJ = new Date(now.getTime() + 9 * 3600000).toISOString().slice(0, 10);
  layers.animals = { kind: 'daily', reviewedAt: animals.reviewedAt, items: toItems(pickDaily(animals.facts, todayJ), todayJ) };

  rmSync(OUT, { recursive: true, force: true });
  cpSync(resolve(ROOT, 'site'), OUT, { recursive: true });
  mkdirSync(resolve(OUT, 'data/layers'), { recursive: true });

  const meta = { builtAt: now.toISOString(), mode: OFFLINE ? 'offline' : SNAPSHOT ? 'snapshot' : 'live', layers: {} };
  for (const [layer, v] of Object.entries(layers)) {
    // 自動取得の分野が確認版で空のときは「未取得」（準備中ではない）
    // 地震のように自動取得だけの分野：取得できた（0件を含む）なら ok、公開版で取得に失敗したら fetchFailed
    const lf = Object.values(feeds).filter((f) => f.layer === layer).map((f) => f.status);
    const status = v.items.length
      ? 'ok'
      : v.kind === 'auto' && lf.includes('notFetched')
        ? 'notFetched'
        : v.kind === 'auto' && lf.some((x) => x === 'ok' || x === 'empty')
          ? 'ok'
          : (v.kind === 'auto' || v.kind === 'mixed') && lf.some((x) => x === 'failed' || x === 'invalid')
            ? 'fetchFailed' // 手動掲載も0件で、自動取得も失敗した混合分野は「準備中」ではなく「取得できなかった」と示す
            : v.kind === 'auto' && (SNAPSHOT || OFFLINE)
              ? 'notFetched'
              : 'preparing';
    writeFileSync(resolve(OUT, `data/layers/${layer}.json`), JSON.stringify({ layer, status, ...v }));
    meta.layers[layer] = { kind: v.kind, status, count: v.items.filter((x) => !x.superseded).length, retrievedAt: v.retrievedAt ?? null, reviewedAt: v.reviewedAt ?? null };
    const fs = Object.entries(feeds).filter(([, f]) => f.layer === layer);
    if (fs.length) meta.layers[layer].feeds = Object.fromEntries(fs.map(([k, f]) => [k, { status: f.status, raw: f.raw, dropped: f.dropped }]));
  }
  // 更新履歴（公開用：日付・作業者の種別・要約・対象idのみ）
  const log = changelog.entries.map(({ date, by, summary, ids }) => ({ date, by, summary, ids })).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 100);
  writeFileSync(resolve(OUT, 'data/changelog.json'), JSON.stringify({ mode: meta.mode, entries: log }));
  // 過去の記録の一覧（データベース）：手動で掲載した情報（entries.json）を、表示から外れたものも含めてすべて出す。
  // 自動取得の情報は保存しない（Actions に書き込み権限を持たせないため。2026-10-27 運用者の決定）
  const ARCHIVE_LAYER = { mental: 'care', welfare: 'care' };
  const archive = curated.items
    .map(({ id, layer, title, summary, attribution, tags, countries, publishedAt, checkedAt, source }) => ({
      id,
      layer: ARCHIVE_LAYER[layer] || layer,
      ...(ARCHIVE_LAYER[layer] ? { sub: layer } : {}),
      title,
      summary,
      ...(attribution ? { attribution } : {}),
      tags: tags || [],
      countries: countries || [],
      publishedAt,
      checkedAt,
      source,
    }))
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || a.id.localeCompare(b.id));
  writeFileSync(resolve(OUT, 'data/archive.json'), JSON.stringify({ reviewedAt: curated.reviewedAt, count: archive.length, items: archive }));
  writeFileSync(resolve(OUT, 'data/meta.json'), JSON.stringify(meta));
  writeFileSync(resolve(OUT, 'data/directory.json'), JSON.stringify(directory));
  writeSeo(OUT, { siteUrl: process.env.SITE_URL, repo: process.env.GITHUB_REPOSITORY, google: process.env.GOOGLE_SITE_VERIFICATION, bing: process.env.BING_SITE_VERIFICATION, now });
  // 見つからないページ（404.html）：GitHub Pages は、どの深さの存在しない URL にもこのページを返すため、
  // 公開 URL が分かるときは、相対のリンク（css/… など）をサイトの先頭からの絶対パスに直す
  {
    const { parseSiteUrl } = await import('./lib/seo.mjs');
    const site = parseSiteUrl(process.env.SITE_URL);
    const f = resolve(OUT, '404.html');
    if (site && existsSync(f)) {
      const basePath = new URL(site).pathname; // 例：/Tomoshibi-atlas/
      const html = readFileSync(f, 'utf8').replace(/\b(href|src)="(?!https:|#|\/)([^"]*)"/g, (_, attr, rel) => `${attr}="${basePath}${rel === './' ? '' : rel.replace(/^\.\//, '')}"`);
      writeFileSync(f, html);
    }
  }
  // 確認・改装中の表示：運用者が main に ops/MAINTENANCE を置いたときだけ、トップ（地球儀）を「ただいま確認・改装中です」に差し替える。
  // 説明ページ（福祉の相談先・セキュリティ対策・このサイトについて）はそのまま見られる。戻すときは ops/MAINTENANCE を消す
  if (MAINTENANCE) {
    cpSync(resolve(OUT, 'maintenance.html'), resolve(OUT, 'index.html'));
    console.log('::warning::ops/MAINTENANCE があるため、トップを「確認・改装中」の表示にしました');
  }
  if (!existsSync(resolve(OUT, 'index.html'))) throw new Error('index.html missing');
  console.log(`build OK (${meta.mode}):`, Object.entries(meta.layers).map(([k, v]) => `${k}=${v.count}`).join(' '));
}

main().catch((e) => {
  console.error('build failed:', e.message);
  process.exit(1);
});
