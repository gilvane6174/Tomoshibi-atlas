// プルリクエストの検査（CIで実行）。このスクリプトは必ず main 側（信頼できる側）のものを使い、
// PR 側のフォルダを作業ディレクトリにして実行する（.github/workflows/validate.yml）。
//
// すべての PR：コミットの作者メールが GitHub の noreply であること、コミットメッセージと PR の題名・本文に個人情報・秘密情報が無いこと
// 運用者の PR：範囲の制限なし。運用者の PR と認める条件は scripts/lib/owner-pr.mjs（scope-guard.mjs と同じ判定）。
//   作成者＝MAINTAINER_LOGIN・同じリポジトリ・curated/ 以外のブランチ・GitHub App を通さずに作られたと API で確かめられたこと
// Dependabot：.github/ 内の Actions 設定のみ
// それ以外（AI・bot・外部の人、および curated/ ブランチ）：
//   - 変更してよいのは data/curated/entries.json と data/curated/changelog.json の2つだけ（追加・削除・リンク化は不可）
//   - 更新履歴は追記のみ。新しい記録の日付は日本時間の今日から3日前まで。作業者に operator は使えない
//   - 追加・変更・削除・非表示になる項目は、新しい更新履歴に id を記録すること
//   - importance を major にした項目の追加・変更は不可（運用者だけが行う）
// 値はすべて環境変数で受け取り、シェルに埋め込まない（コマンド注入対策）。

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { scanText } from './check-privacy.mjs';
import { applySupersede } from './lib/supersede.mjs';
import { todayJst } from './lib/safety.mjs';
import { ownerExemption, fetchViaApp, describeViaApp, SKIP_CHECKS } from './lib/owner-pr.mjs';

const env = process.env;
const { PR_AUTHOR = '', MAINTAINER_LOGIN = '', BASE_SHA = '', HEAD_SHA = '', HEAD_REF = '', PR_TITLE = '', PR_BODY = '', BASE_REF = '', TRUSTED_ROOT = '' } = env;
const errors = [];
const fail = (m) => errors.push(m);
// main 以外を宛先にした PR は受け付けない（宛先を差し替えて、書き換えた検査プログラムで通すのを防ぐ）
if (BASE_REF && BASE_REF !== 'main') fail(`PR の宛先は main にしてください（${BASE_REF}）`);
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });

const SHA = /^[0-9a-f]{40}$/;
if (!SHA.test(BASE_SHA) || !SHA.test(HEAD_SHA)) {
  console.error('BASE_SHA / HEAD_SHA が不正です');
  process.exit(1);
}
if (!/^[A-Za-z0-9._/-]{1,200}$/.test(HEAD_REF)) fail('ブランチ名に使えない文字が含まれています（英数字と . _ / - のみ）');
if (!MAINTAINER_LOGIN) fail('リポジトリ変数 MAINTAINER_LOGIN が未設定です（docs/GITHUB-SETTINGS.md）');

// ── すべてのPR：コミット情報と PR 文面の個人情報検査 ──
const NOREPLY = /(@users\.noreply\.github\.com|^noreply@github\.com)$/i;
const AI_LOGINS = (env.AI_ACCOUNT_LOGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
const NAMES = new Set([MAINTAINER_LOGIN, ...AI_LOGINS, 'dependabot[bot]', 'GitHub', 'Yutaka Yoshioka', '吉岡有隆'].filter(Boolean));
const OWNER_MAIL = new RegExp(`^(\\d+\\+)?${MAINTAINER_LOGIN.replace(/[^A-Za-z0-9-]/g, '')}@users\\.noreply\\.github\\.com$`, 'i');
// GitHub App を通して作られた PR かどうか（API で確かめる。確かめられなければ運用者扱いしない）。
// 手元での再現（GitHub Actions の外）に限り、TA_LOCAL_VIA_APP=null で「アプリを通していない」とみなせる
const viaApp =
  env.GITHUB_ACTIONS !== 'true' && env.TA_LOCAL_VIA_APP === 'null' ? null : await fetchViaApp(env.REPO || env.GITHUB_REPOSITORY || '', env.PR_NUMBER || '', env.GH_TOKEN || '');
const owner = ownerExemption({ author: PR_AUTHOR, owner: MAINTAINER_LOGIN, repo: env.REPO || env.GITHUB_REPOSITORY || '', headRepo: env.HEAD_REPO || '', headRef: HEAD_REF, viaApp, mode: env.OWNER_PR_CHECK });
console.log(`PR の作成元（performed_via_github_app）：${describeViaApp(viaApp)}`);
const isOwnerPr = owner.exempt;
if (PR_AUTHOR === MAINTAINER_LOGIN && !isOwnerPr) console.log(`運用者の名義の PR ですが、範囲の制限をかけます（${owner.reason}）`);
const log = git('log', '--format=%an%x00%ae%x00%cn%x00%ce%x00%B%x1e', `${BASE_SHA}..${HEAD_SHA}`).split('\x1e').filter((s) => s.trim());
log.forEach((rec, i) => {
  const [an, ae, cn, ce, msg] = rec.replace(/^\n/, '').split('\x00').map((x) => x ?? '');
  if (!NOREPLY.test(ae.trim()) || !NOREPLY.test(ce.trim())) fail(`コミット${i + 1}：作者・コミッターのメールが GitHub の noreply アドレスではありません（個人のメールアドレスが公開されます）`);
  if (!NAMES.has(an.trim()) || !NAMES.has(cn.trim())) fail(`コミット${i + 1}：作者・コミッターの名前は GitHub のユーザー名にしてください（本名などの個人情報が公開されます）`);
  if (isOwnerPr && (!OWNER_MAIL.test(ae.trim()) || !(OWNER_MAIL.test(ce.trim()) || /^noreply@github\.com$/i.test(ce.trim())))) fail(`コミット${i + 1}：運用者のPRに運用者以外のコミットが含まれています`);
  for (const line of (msg || '').split('\n')) for (const label of scanText(line)) fail(`コミット${i + 1}のメッセージ：${label}`);
  // 検査を飛ばす指示（skip-checks: true、[skip ci] など）はこのリポジトリでは使わない
  if (SKIP_CHECKS.test(msg || '')) fail(`コミット${i + 1}のメッセージ：検査を飛ばす指示（skip-checks・skip ci など）は使えません`);
});
for (const [name, text] of [['PRの題名', PR_TITLE], ['PRの本文', PR_BODY]])
  for (const line of text.split('\n')) for (const label of scanText(line)) fail(`${name}：${label}`);

// ── 変更範囲 ──
const raw = git('diff', '--name-status', '--no-renames', '-z', `${BASE_SHA}...${HEAD_SHA}`).split('\0').filter(Boolean);
const changes = [];
for (let i = 0; i < raw.length; i += 2) changes.push({ status: raw[i], path: raw[i + 1] });

const DATA = ['data/curated/entries.json', 'data/curated/changelog.json'];
const isOwner = isOwnerPr;
const isDependabot = PR_AUTHOR === 'dependabot[bot]';

if (isOwner) {
  console.log('運用者のPR：範囲の制限なし（レビューは必須）');
} else if (isDependabot) {
  // Dependabot のPRに、Dependabot 以外が作ったコミットを混ぜて通すことを防ぐ
  log.forEach((rec, i) => {
    const [an, , cn] = rec.replace(/^\n/, '').split('\x00');
    if (an.trim() !== 'dependabot[bot]' || !['dependabot[bot]', 'GitHub'].includes(cn.trim())) fail(`コミット${i + 1}：Dependabot のPRに Dependabot 以外のコミットが含まれています`);
  });
  for (const c of changes) if (c.status !== 'M' || !/^\.github\/(workflows\/[A-Za-z0-9_-]+\.ya?ml|dependabot\.yml)$/.test(c.path)) fail(`Dependabot は変更できないファイル: ${c.path}`);
} else {
  // 緊急停止スイッチ：main に ops/AI-PAUSE があるあいだは、AI・bot・外部のPRをすべて止める（運用者だけが置く・消す）
  if (git('ls-tree', BASE_SHA, '--', 'ops/AI-PAUSE').trim() || (TRUSTED_ROOT && existsSync(resolve(TRUSTED_ROOT, 'ops/AI-PAUSE')))) fail('運用者が AI・bot の作業を一時停止しています（ops/AI-PAUSE）。再開の連絡があるまで PR を出さないでください');
  if (log.length > 20) fail(`コミットが多すぎます（${log.length}件）。1回のPRは20コミット以内にしてください`);
  for (const c of changes) {
    if (!DATA.includes(c.path)) fail(`AI・bot・外部の作成者は変更できないファイル: ${c.path}`);
    else if (c.status !== 'M') fail(`${c.path} は修正のみ可能（追加・削除は不可）`);
  }
  // ファイルの種類（通常ファイル 100644 であること。シンボリックリンク等へのすり替えを拒否）
  for (const p of DATA) {
    const mode = git('ls-tree', HEAD_SHA, '--', p).split(/\s+/)[0];
    if (mode !== '100644') fail(`${p} が通常のファイルではありません（${mode || 'なし'}）`);
  }
  const touched = new Set(changes.map((c) => c.path));
  if (touched.has(DATA[0]) && !touched.has(DATA[1])) fail('entries.json を変更した場合は changelog.json（更新履歴）にも記録が必要です');

  if (errors.length === 0 && touched.size > 0) semanticChecks();
}

function show(sha, path) {
  return JSON.parse(git('show', `${sha}:${path}`));
}

function semanticChecks() {
  const [eb, eh] = [show(BASE_SHA, DATA[0]), show(HEAD_SHA, DATA[0])];
  // 全体の確認日（reviewedAt：運用者が掲載内容を見直した日として表示される）と書式の版は、運用者だけが変える
  for (const k of ['reviewedAt', 'schemaVersion']) if (!isDeepStrictEqual(eb?.[k], eh?.[k])) fail(`${DATA[0]} の ${k} は運用者だけが変更できます`);
  const [lb, lh] = [show(BASE_SHA, DATA[1]), show(HEAD_SHA, DATA[1])];
  // 更新履歴は追記のみ
  if (!Array.isArray(lh.entries) || !isDeepStrictEqual(lh.entries.slice(0, lb.entries.length), lb.entries)) return fail('更新履歴は末尾への追記のみ可能です（既存の記録の変更・削除・並べ替えは不可）');
  const added = lh.entries.slice(lb.entries.length);
  if (added.length === 0) return fail('更新履歴に今回の記録を追記してください');
  const today = todayJst();
  // 日付は日本時間の「今日から3日前まで」を受け付ける（運用者の確認待ちで数日かかっても、出し直しで済むように）
  const recent = [0, 1, 2, 3].map((n) => new Date(Date.parse(today) - n * 86400000).toISOString().slice(0, 10));
  for (const e of added) {
    if (!recent.includes(e.date)) fail(`新しい更新履歴の日付は日本時間の今日から3日前までにしてください（${e.date}）`);
    if (!['ai-curator', 'bot-curator'].includes(e.by)) fail(`AI・bot の更新履歴の作業者は ai-curator か bot-curator です（${e.by}）`);
  }
  if (added.length > 3) fail(`1回のPRで追記できる更新履歴は3件までです（${added.length}件）`);
  const logged = new Set(added.flatMap((e) => e.ids || []));

  const byId = (doc) => new Map((doc.items || []).map((it) => [it.id, it]));
  const [mb, mh] = [byId(eb), byId(eh)];
  for (const [id, it] of mh) {
    const before = mb.get(id);
    const changed = !before || !isDeepStrictEqual(before, it);
    if (changed && !logged.has(id)) fail(`${id}：追加・変更した項目は、新しい更新履歴の ids に記録してください`);
    if (changed && it.importance === 'major') fail(`${id}：importance を major にした項目の追加・変更は運用者だけが行えます`);
  }
  for (const id of mb.keys()) if (!mh.has(id) && !logged.has(id)) fail(`${id}：削除した項目は、新しい更新履歴の ids に記録してください`);

  // 量の上限（乗っ取られた AI・bot による大量の書き換え・一括削除を防ぐ）
  const changedIds = [...mh].filter(([id, it]) => !mb.has(id) || !isDeepStrictEqual(mb.get(id), it)).map(([id]) => id);
  const removedIds = [...mb.keys()].filter((id) => !mh.has(id));
  // 削除だけでなく「表示されなくなる」項目も削除と同じ数に数える（新しい項目で古い項目を隠す抜け道を防ぐ）
  const vis = (doc) => new Set(applySupersede(doc.items || []).filter((x) => !x.superseded).map((x) => x.id));
  const [visB, visH] = [vis(eb), vis(eh)];
  const hiddenIds = [...visB].filter((id) => !visH.has(id));
  if (hiddenIds.length > 3) fail(`1回のPRで表示されなくなる項目（削除・以前の情報になるもの）は3件までです（${hiddenIds.length}件）`);
  // 既存の項目の分野・話題・国は、AI・bot が変えない（変えると、別の項目を隠したり場所を偽ったりできるため）
  for (const [id, it] of mh) {
    const b = mb.get(id);
    if (b && (b.layer !== it.layer || b.topic !== it.topic || !isDeepStrictEqual(b.countries, it.countries))) fail(`${id}：既存の項目の layer・topic・countries の変更は運用者だけが行えます`);
    if ((it.tags || []).includes('approved') && !isDeepStrictEqual(b?.tags, it.tags)) fail(`${id}：tags の approved（承認済み）は運用者だけが付けられます`);
    // 運用者が承認済みにした項目は、中身（題名・要約・原典など）も AI・bot が変えない（承認済みの表示のまま中身を差し替える抜け道を防ぐ）
    if ((b?.tags || []).includes('approved') && !isDeepStrictEqual(b, it)) fail(`${id}：承認済み（approved）の項目の変更は運用者だけが行えます`);
  }
  if (changedIds.length > 10) fail(`1回のPRで追加・変更できる項目は10件までです（${changedIds.length}件）`);
  if (removedIds.length > 3) fail(`1回のPRで削除できる項目は3件までです（${removedIds.length}件）。それ以上は運用者に依頼してください`);
  // 追加・変更した項目は、今日から3日前までに原典を確認していること（古い確認のまま出さない）
  for (const id of changedIds) {
    const c = mh.get(id).checkedAt;
    if (!recent.includes(c)) fail(`${id}：checkedAt（原典を実際に開いて確認した日）は日本時間の今日から3日前までにしてください（${c ?? 'なし'}）。日付だけを書き換えず、原典を開き直して確認すること`);
  }

  // 以前は表示されていた項目が、今回の変更で非表示・「以前の情報」になる場合も記録が必要
  const visible = (doc) => new Set(applySupersede(doc.items || []).filter((x) => !x.superseded).map((x) => x.id));
  const [vb, vh] = [visible(eb), visible(eh)];
  for (const id of vb) if (mh.has(id) && !vh.has(id) && !logged.has(id)) fail(`${id}：今回の変更で非表示または「以前の情報」になります。意図した場合は更新履歴の ids に記録してください`);
}

if (errors.length) {
  console.error(`PR検査で問題: ${errors.length}件`);
  for (const e of errors) console.error(' - ' + e);
  process.exit(1);
}
console.log(`PR検査OK（${isOwner ? '運用者' : isDependabot ? 'Dependabot' : 'AI・bot・外部'}、${changes.length}ファイル、コミット${log.length}件）`);
