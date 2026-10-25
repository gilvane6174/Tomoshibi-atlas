// サイトを組み立てる。GitHub Actions でもローカルでも同じ処理。
//   node scripts/build.mjs           … 公的機関から取得して _site/ を作る（本番）
//   node scripts/build.mjs --offline … ネットに接続せず組み立てる（手動掲載の実データのみ。自動取得の分野は「未取得」と表示）
// 取得・検査のどこかで失敗したら終了コード1で止まり、_site/ は公開されない。
// その場合、公開中のサイトは前回の内容のまま残る（壊れたデータで上書きしない設計）。

import './lib/node-guard.mjs';
import { cpSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT, readData } from './lib/safety.mjs';
import { validateItems, validateCuratedPair, validateDirectory, validateEvidence, CURATED_LAYERS } from './validate-data.mjs';
import { applySupersede } from './lib/supersede.mjs';
import { writeSeo } from './lib/seo.mjs';

const OFFLINE = process.argv.includes('--offline');
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
    const file = resolve(dir, layer === 'outbreak' ? 'who-don.json' : 'cisa-kev.json');
    const list = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : [];
    if (layer === 'outbreak') return (await import('./fetch-who-don.mjs')).processDonList(list, now.getTime());
    const { normalizeKev } = await import('./fetch-security.mjs');
    return list.map((v) => normalizeKev(v, now.getTime())).filter(Boolean);
  }
  if (layer === 'outbreak') return (await import('./fetch-who-don.mjs')).fetchOutbreaks();
  if (layer === 'security') return (await import('./fetch-security.mjs')).fetchSecurity();
  throw new Error('unknown auto layer ' + layer);
}

const SHOW_METHODS = new Set(['fetched', 'operator']);

async function main() {
  const errors = [];
  const base = 'data/curated/entries.json';
  const logRel = 'data/curated/changelog.json';
  errors.push(...validateCuratedPair(base, logRel));
  errors.push(...validateDirectory('data/directory/links.json'));
  errors.push(...validateEvidence());
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
          const e = evidence[l.id];
          if (!e || !SHOW_METHODS.has(e.method) || e.url !== l.url || !e.checkedAt) return (hidden++, []);
          return [{ ...l, checkedAt: e.checkedAt }];
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
  };
  if (hidden) console.log(`リンク集：確認の記録がない ${hidden} 件は表示しない（data/directory/evidence.json）`);
  const curated = readData(base);
  const changelog = readData(logRel);

  const auto = {};
  for (const layer of ['outbreak', 'security']) {
    auto[layer] = await loadAuto(layer);
    errors.push(...validateItems(auto[layer], { layer, curated: false }));
    if (!OFFLINE && !SNAPSHOT && auto[layer].length === 0) errors.push(`${layer}: 取得結果が0件 — 異常とみなして公開を中止`);
  }
  if (errors.length) {
    console.error(`検査失敗のため公開を中止: ${errors.length}件`);
    for (const e of errors.slice(0, 50)) console.error(' - ' + e);
    process.exit(1);
  }
  const snapAt = SNAPSHOT && process.env.TA_SNAPSHOT_AT && !Number.isNaN(Date.parse(process.env.TA_SNAPSHOT_AT)) ? new Date(process.env.TA_SNAPSHOT_AT).toISOString() : now.toISOString();

  const layers = {
    outbreak: { kind: 'auto', retrievedAt: OFFLINE ? null : SNAPSHOT ? snapAt : now.toISOString(), items: applySupersede(auto.outbreak, now) },
    security: { kind: 'auto', retrievedAt: OFFLINE ? null : SNAPSHOT ? (auto.security.length ? snapAt : null) : now.toISOString(), items: applySupersede(auto.security, now) },
  };
  for (const layer of CURATED_LAYERS) {
    layers[layer] = { kind: 'curated', reviewedAt: curated.reviewedAt, items: applySupersede(curated.items.filter((it) => it.layer === layer), now) };
  }

  rmSync(OUT, { recursive: true, force: true });
  cpSync(resolve(ROOT, 'site'), OUT, { recursive: true });
  mkdirSync(resolve(OUT, 'data/layers'), { recursive: true });

  const meta = { builtAt: now.toISOString(), mode: OFFLINE ? 'offline' : SNAPSHOT ? 'snapshot' : 'live', layers: {} };
  for (const [layer, v] of Object.entries(layers)) {
    // 自動取得の分野が確認版で空のときは「未取得」（準備中ではない）
    const status = v.items.length ? 'ok' : v.kind === 'auto' && (SNAPSHOT || OFFLINE) ? 'notFetched' : 'preparing';
    writeFileSync(resolve(OUT, `data/layers/${layer}.json`), JSON.stringify({ layer, status, ...v }));
    meta.layers[layer] = { kind: v.kind, status, count: v.items.filter((x) => !x.superseded).length, retrievedAt: v.retrievedAt ?? null, reviewedAt: v.reviewedAt ?? null };
  }
  // 更新履歴（公開用：日付・作業者の種別・要約・対象idのみ）
  const log = changelog.entries.map(({ date, by, summary, ids }) => ({ date, by, summary, ids })).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 100);
  writeFileSync(resolve(OUT, 'data/changelog.json'), JSON.stringify({ mode: meta.mode, entries: log }));
  writeFileSync(resolve(OUT, 'data/meta.json'), JSON.stringify(meta));
  writeFileSync(resolve(OUT, 'data/directory.json'), JSON.stringify(directory));
  writeSeo(OUT, { siteUrl: process.env.SITE_URL, repo: process.env.GITHUB_REPOSITORY, google: process.env.GOOGLE_SITE_VERIFICATION, bing: process.env.BING_SITE_VERIFICATION, now });
  if (!existsSync(resolve(OUT, 'index.html'))) throw new Error('index.html missing');
  console.log(`build OK (${meta.mode}):`, Object.entries(meta.layers).map(([k, v]) => `${k}=${v.count}`).join(' '));
}

main().catch((e) => {
  console.error('build failed:', e.message);
  process.exit(1);
});
