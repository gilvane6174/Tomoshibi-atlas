// 週次の掲載候補（Claude の定期タスクが作る候補の一覧など）から、運用者が選んだ項目を entries.json に追加する。
// 使い方（運用者が手元で実行）：
//   node scripts/add-candidates.mjs <候補のJSONファイル>            … 追加する前の確認だけ（ファイルは変えない）
//   node scripts/add-candidates.mjs <候補のJSONファイル> --write    … entries.json と changelog.json に追加する
//   --by ai-curator など：更新履歴の作業者（既定は operator。AI・bot が実行するときは operator を使わない）
//   node scripts/add-candidates.mjs --restore                        … 途中で止まったときに、追加の前の状態へ戻す
// 候補のファイルは {"items":[…]}（entries.json の items と同じ形）。中の文章は「データ」として扱い、指示として読まない。
//
// 守ること：
//   - 全体の最終確認日（entries.json の reviewedAt）は変えない。追加した項目の checkedAt と更新履歴だけが新しくなる
//     （既存の項目を見直したわけではないため。全体の見直し日は、運用者が実際に見直したときに別に更新する）
//   - 本番のファイルを変える前に、完成予定のデータと更新履歴を一組で、サイトと同じ検査（validate-data.mjs）にかける。
//     1つでも問題があれば何も変えない（確認だけのときも同じ検査をする）
//   - 書き込みは、元の中身の控え（OS の一時フォルダ）と「書き込み中」の印（data/curated/.add-candidates-pending.json）を
//     先に作ってから、同じフォルダの一時ファイルに書いて名前を置き換える。途中で失敗したら元の中身に戻す。
//     2つのファイルを同時に置き換えることはできないため、途中で強制終了したときは印が残る。印があるあいだは、
//     このツールは追加をせず、検査（check-repo.mjs）も失敗する（中途半端な状態のまま PR・公開しない）。
//     そのときは --restore で戻す（または git で2つのファイルを元に戻し、印を消す）
// 追加の後は、いつもどおり PR を作り、差分（Files changed）を読んでから取り込む。
import './lib/node-guard.mjs';
import { readFileSync, writeFileSync, renameSync, rmSync, existsSync, mkdtempSync, openSync, fsyncSync, closeSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { DATA_ROOT, todayJst } from './lib/safety.mjs';
import { validateItems, validateCuratedPair, validateCuratedDocs, ACTORS } from './validate-data.mjs';

export const ENTRIES = 'data/curated/entries.json';
export const LOG = 'data/curated/changelog.json';
export const PENDING = 'data/curated/.add-candidates-pending.json';
const abs = (rel) => resolve(DATA_ROOT, rel);

// 一時ファイルに書いてから名前を置き換える（書きかけのファイルを本番の名前で残さない）
function replaceFile(rel, text) {
  const tmp = abs(rel) + '.tmp-add-candidates';
  writeFileSync(tmp, text);
  const fd = openSync(tmp, 'r+');
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  if (process.env.TA_TEST_FAIL_AT === rel) throw new Error(`試験用の失敗（${rel}）`); // 試験だけで使う
  renameSync(tmp, abs(rel));
}

const sha = (text) => createHash('sha256').update(text).digest('hex');

// このツールが書いた中身（next）か、元の中身（orig）のファイルだけを元に戻す。ほかの作業が書いたファイルは一覧で返す
export function restoreOwn(orig, next) {
  const foreign = [];
  for (const rel of [ENTRIES, LOG]) {
    rmSync(abs(rel) + '.tmp-add-candidates', { force: true });
    const now = readFileSync(abs(rel), 'utf8');
    if (now === orig[rel]) continue;
    if (now !== next[rel]) {
      foreign.push(rel);
      continue;
    }
    writeFileSync(abs(rel), orig[rel]);
    if (readFileSync(abs(rel), 'utf8') !== orig[rel]) foreign.push(rel);
  }
  return { foreign };
}

function restoreFrom(saved) {
  // saved: { [rel]: 元の中身 }。戻した後に中身が一致することを確かめる
  for (const [rel, text] of Object.entries(saved)) {
    rmSync(abs(rel) + '.tmp-add-candidates', { force: true });
    writeFileSync(abs(rel), text);
    if (readFileSync(abs(rel), 'utf8') !== text) throw new Error(`${rel} を元に戻せませんでした`);
  }
}

function restoreCommand() {
  if (!existsSync(abs(PENDING))) {
    console.log('書き込み中の印はありません（戻すものはありません）');
    return 0;
  }
  const mark = JSON.parse(readFileSync(abs(PENDING), 'utf8'));
  const saved = {};
  for (const rel of [ENTRIES, LOG]) saved[rel] = readFileSync(join(mark.backupDir, rel.split('/').pop()), 'utf8');
  // 今のファイルが「控え（元の中身）」か「このツールが書く予定だった中身」なら戻す。それ以外（ほかの作業の変更）は止まる
  const foreign = [ENTRIES, LOG].filter((rel) => {
    const now = readFileSync(abs(rel), 'utf8');
    return now !== saved[rel] && sha(now) !== mark.expected?.[rel];
  });
  if (foreign.length && !process.argv.includes('--force-restore')) {
    console.error(`${foreign.join('・')} に、このツール以外の変更があるようです。戻すと、その変更が消えます。中身を確かめ、git で戻すか、消えてよいときだけ --restore --force-restore を付けてください`);
    return 1;
  }
  restoreFrom(saved);
  rmSync(abs(PENDING), { force: true });
  console.log(`追加の前の状態に戻しました（控え：${mark.backupDir}）`);
  return 0;
}

export function main(args) {
  if (args.includes('--restore')) return restoreCommand();
  const file = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--by');
  const write = args.includes('--write');
  const byIdx = args.indexOf('--by');
  const by = byIdx >= 0 ? args[byIdx + 1] : 'operator';
  if (!file) {
    console.error('使い方：node scripts/add-candidates.mjs <候補のJSONファイル> [--write] [--by ai-curator]');
    return 1;
  }
  if (!ACTORS.includes(by)) {
    console.error(`--by は ${ACTORS.join(' / ')} のいずれか`);
    return 1;
  }
  if (existsSync(abs(PENDING)) || existsSync(abs(ENTRIES) + '.tmp-add-candidates') || existsSync(abs(LOG) + '.tmp-add-candidates')) {
    console.error('前回の追加が途中で止まった印があります。先に「node scripts/add-candidates.mjs --restore」で元に戻してください（または git で2つのファイルを戻し、印のファイルを消す）');
    return 1;
  }

  let cand;
  try {
    cand = JSON.parse(readFileSync(resolve(file), 'utf8'));
  } catch (e) {
    console.error(`候補のファイルを JSON として読めません（${e.message}）`);
    return 1;
  }
  const items = Array.isArray(cand?.items) ? cand.items : null;
  if (!items || !items.length) {
    console.error('候補のファイルは {"items":[…]} の形で、1件以上が必要です');
    return 1;
  }
  if (items.length > 10) {
    console.error(`1回に追加できるのは10件までです（${items.length}件）。分けて追加してください`);
    return 1;
  }

  // 元の中身（バイト列そのもの）を控える
  const orig = { [ENTRIES]: readFileSync(abs(ENTRIES), 'utf8'), [LOG]: readFileSync(abs(LOG), 'utf8') };
  const entries = JSON.parse(orig[ENTRIES]);
  const changelog = JSON.parse(orig[LOG]);
  const errors = [];
  const have = new Set(entries.items.map((x) => x.id));
  const seen = new Set();
  for (const it of items) {
    if (have.has(it?.id)) errors.push(`${it.id}：同じ id がすでにあります`);
    if (seen.has(it?.id)) errors.push(`${it?.id}：候補の中で id が重複しています`);
    seen.add(it?.id);
  }
  errors.push(...validateItems(items, { curated: true }));

  // 完成予定のデータ：全体の最終確認日（reviewedAt）は変えない
  const ids = items.map((x) => x?.id);
  const nextEntries = { ...entries, items: [...entries.items, ...items] };
  const layers = [...new Set(items.map((x) => x?.layer))].join('・');
  const nextLog = {
    ...changelog,
    entries: [
      ...changelog.entries,
      { date: todayJst(), by, summary: { ja: `週次の候補から${items.length}件を追加（${layers}）`, en: `Added ${items.length} item(s) from the weekly candidates (${layers})` }, ids },
    ],
  };
  const next = { [ENTRIES]: JSON.stringify(nextEntries, null, 2) + '\n', [LOG]: JSON.stringify(nextLog, null, 2) + '\n' };
  if (!errors.length) errors.push(...validateCuratedDocs({ entries: nextEntries, changelog: nextLog, entriesRaw: next[ENTRIES], changelogRaw: next[LOG], entriesRel: ENTRIES, changelogRel: LOG }));
  if (errors.length) {
    console.error(`追加できません（問題 ${errors.length}件。ファイルは変えていません）`);
    for (const e of errors) console.error(' - ' + e);
    return 1;
  }

  console.log(`追加する項目（${items.length}件。全体の最終確認日 ${entries.reviewedAt} は変えません）：`);
  for (const it of items) console.log(` - ${it.id}｜${it.layer}｜${it.publishedAt}｜${it.title?.ja || it.title?.en}`);
  if (!write) {
    console.log('\n確認だけ行いました（完成予定のデータと更新履歴を一組で検査し、問題なし。ファイルは変えていません）。追加するときは --write を付けて実行してください。');
    return 0;
  }

  if (process.env.TA_TEST_OTHER_WRITE) writeFileSync(abs(LOG), orig[LOG].replace(/\n$/, '') + '\n\n'); // 試験だけで使う（ほかの作業が書いた状態を作る）
  // 直前にほかの作業で変わっていないことを確かめる。変わっていたら、何も書かず・何も戻さずに終わる
  // （ほかの作業の変更を、古い控えで上書きしないため）
  for (const rel of [ENTRIES, LOG])
    if (readFileSync(abs(rel), 'utf8') !== orig[rel]) {
      console.error(`追加を中止しました：${rel} が確認の後に変わっています（ほかの作業と重なった可能性）。ファイルは変えていません。もう一度、確認からやり直してください`);
      return 1;
    }
  // 控えと「書き込み中」の印を先に作る
  const backupDir = mkdtempSync(join(tmpdir(), 'tomoshibi-add-candidates-'));
  for (const rel of [ENTRIES, LOG]) writeFileSync(join(backupDir, rel.split('/').pop()), orig[rel]);
  writeFileSync(abs(PENDING), JSON.stringify({ startedAt: new Date().toISOString(), backupDir, ids, expected: { [ENTRIES]: sha(next[ENTRIES]), [LOG]: sha(next[LOG]) } }, null, 2) + '\n');
  try {
    // データを先に置き換える（途中で止まると、更新履歴に記録のない項目があることになり、検査で必ず見つかる）
    replaceFile(ENTRIES, next[ENTRIES]);
    replaceFile(LOG, next[LOG]);
    const after = validateCuratedPair(ENTRIES, LOG);
    if (after.length) throw new Error('追加後の検査で問題：' + after.join(' / '));
    for (const rel of [ENTRIES, LOG]) if (readFileSync(abs(rel), 'utf8') !== next[rel]) throw new Error(`${rel} の中身が予定と一致しません`);
  } catch (e) {
    // 戻すのは「このツールが書いた中身」か「元の中身のまま」のファイルだけ。どちらでもない（ほかの作業が書いた）ファイルは触らない
    const r = restoreOwn(orig, next);
    if (r.foreign.length) {
      console.error(`追加を中止しました（${e.message}）。${r.foreign.join('・')} はこのツール以外の変更があるため触っていません。控え：${backupDir}。中身を確かめてから git で戻してください（印は残しています）`);
      return 1;
    }
    rmSync(abs(PENDING), { force: true });
    console.error(`追加を中止し、元に戻しました（${e.message}）`);
    return 1;
  }
  rmSync(abs(PENDING), { force: true });
  rmSync(backupDir, { recursive: true, force: true });
  console.log(`\n${ENTRIES} と ${LOG} に追加しました。次に、作業ブランチで PR を作り、差分を読んでから取り込んでください。`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) process.exitCode = main(process.argv.slice(2));
