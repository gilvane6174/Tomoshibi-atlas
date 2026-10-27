// リポジトリ全体の「安全の前提」が崩れていないかを機械的に確認する（CIで実行）。
// 1. CODEOWNERS の仮のユーザー名が置き換わっているか（置き換え忘れるとコードオーナーの承認が効かない）
// 2. ワークフロー：外部の処理（uses）がコミットSHAで固定されているか、危険な起動条件・秘密情報・
//    run 内への ${{ }} 埋め込み（スクリプト注入の入口）が無いか、権限が既定で空になっているか
// 3. 依存パッケージを使っていないか（package.json に依存・インストール時スクリプトが無いか、ロックファイルが無いか）
// 4. サーバー側で動くファイル（PHP など）や実行ファイルが入っていないか（このサイトは静的ファイルだけ）
// 5. 画面の HTML：CSP（外部読み込み・インライン実行の禁止）が保たれているか、インラインのスクリプトや on〜= 属性が無いか
// 6. 同梱ライブラリが、確認済みの中身から変わっていないか（SHA-256）
// 使い方: node scripts/check-repo.mjs     ※ 1 だけを一時的に見逃す確認用： TA_ALLOW_PLACEHOLDER=1
import { readFileSync, readdirSync, lstatSync, existsSync } from 'node:fs';
import { resolve, join, relative, extname } from 'node:path';
import { createHash } from 'node:crypto';
import { DATA_ROOT as ROOT } from './lib/safety.mjs';

const errors = [];
const read = (rel) => readFileSync(resolve(ROOT, rel), 'utf8');

// 1. CODEOWNERS
if (read('.github/CODEOWNERS').includes('OWNER_GITHUB_USERNAME') && process.env.TA_ALLOW_PLACEHOLDER !== '1')
  errors.push('.github/CODEOWNERS の @OWNER_GITHUB_USERNAME を運用者の GitHub ユーザー名に置き換えてください（docs/GITHUB-SETTINGS.md 1章）');

// 2. ワークフロー
const WF = '.github/workflows';
for (const name of readdirSync(resolve(ROOT, WF))) {
  const rel = `${WF}/${name}`;
  if (!/\.ya?ml$/.test(name)) {
    errors.push(`${rel}: ワークフロー以外のファイルは置かない`);
    continue;
  }
  const text = read(rel);
  const lines = text.split('\n');
  if (!/^permissions:\s*\{\}\s*$/m.test(text)) errors.push(`${rel}: 先頭で permissions: {} （既定の権限なし）にする`);
  const noComments = lines.map((l) => l.replace(/\s#.*$|^\s*#.*$/, '')).join('\n');
  // pull_request_target は scope-guard.yml だけに許す（PR のコードを取り出さず、変更ファイルの一覧だけを読む検査）
  const isGuard = name === 'scope-guard.yml';
  for (const bad of ['pull_request_target', 'workflow_run', 'issue_comment', 'repository_dispatch', 'pull_request_review_comment', 'discussion_comment'])
    if (!(isGuard && bad === 'pull_request_target') && new RegExp(`\\b${bad}\\b`).test(noComments)) errors.push(`${rel}: 危険な起動条件 ${bad} は使わない`);
  if (isGuard) {
    if (/^\s*ref:/m.test(noComments) || /head\.sha|merge_commit_sha|refs\/pull/.test(noComments)) errors.push(`${rel}: PR 側のコードを取り出さない（ref: などを書かない）`);
    if (/npm|npx|yarn|pnpm/.test(noComments)) errors.push(`${rel}: パッケージを入れたり実行したりしない`);
    if (!/run: node scripts\/scope-guard\.mjs\s*$/m.test(noComments) || (noComments.match(/\brun:/g) || []).length !== 1) errors.push(`${rel}: 実行してよいのは node scripts/scope-guard.mjs だけ`);
    if (/write/.test(noComments.replace(/#.*$/gm, ''))) errors.push(`${rel}: 書き込み権限は与えない`);
  }
  // PR 側のコード（working-directory: pr）は、main 側の検査がすべて成功したときだけ実行する（validate.yml）
  if (/always\(\)|cancelled\(\)|failure\(\)|continue-on-error:\s*true/.test(noComments)) errors.push(`${rel}: always()・cancelled()・failure()・continue-on-error は使わない（検査の失敗後に処理を続けない）`);
  {
    const steps = noComments.split(/\n(?=\s*- (?:name|uses|run):)/);
    for (const st of steps) if (/working-directory:\s*pr\b/.test(st) && !/run:\s*node\s+\.\.\/trusted\//.test(st) && !/\bif:\s*\$\{\{\s*success\(\)\s*\}\}/.test(st)) errors.push(`${rel}: PR 側のコードを実行する手順には if: \${{ success() }} を付ける`);
  }
  if (/\bsecrets\./.test(text)) errors.push(`${rel}: secrets（秘密情報）は使わない設計`);
  if (/write-all|contents:\s*write|pull-requests:\s*write|actions:\s*write/.test(text)) errors.push(`${rel}: リポジトリへの書き込み権限は与えない`);
  let runIndent = -1;
  lines.forEach((line, i) => {
    const at = `${rel}:${i + 1}`;
    if (/\{\s*uses:/.test(line)) errors.push(`${at}: uses は1行1つの通常の書き方にする（検査のため）`);
    const u = line.match(/^\s*-?\s*["']?uses["']?:\s*["']?([^\s#"']+)/);
    if (u && !/^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/.test(u[1]) && !u[1].startsWith('./')) errors.push(`${at}: uses は40桁のコミットSHAで固定する（${u[1]}）`);
    if (/persist-credentials:\s*true/.test(line)) errors.push(`${at}: persist-credentials は false にする`);
    // run: ブロックの中に ${{ }} を書かない（値は env: で渡す）
    const indent = line.search(/\S/);
    if (runIndent >= 0 && indent >= 0 && indent <= runIndent) runIndent = -1;
    const r = line.match(/^(\s*)-?\s*run:\s*(.*)$/);
    if (r) {
      if (r[2].includes('${{')) errors.push(`${at}: run の中に \${{ }} を書かない（env: で渡す）`);
      runIndent = r[1].length;
    } else if (runIndent >= 0 && line.includes('${{')) errors.push(`${at}: run の中に \${{ }} を書かない（env: で渡す）`);
  });
}

// 3. 依存パッケージ
const pkg = JSON.parse(read('package.json'));
for (const k of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies', 'bundleDependencies'])
  if (pkg[k] && Object.keys(pkg[k]).length) errors.push(`package.json: ${k} は使わない（外部パッケージなしの設計）`);
for (const k of Object.keys(pkg.scripts || {}))
  if (/^(pre|post)?(install|prepare|prepublish|pack)$/.test(k)) errors.push(`package.json: インストール時に動くスクリプト ${k} は置かない`);
for (const f of ['package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb', '.npmrc'])
  if (existsSync(resolve(ROOT, f))) errors.push(`${f}: 外部パッケージを使わないので置かない`);

// 4. サーバー側で動くファイル・実行ファイル
const SERVER_EXT = new Set(['.php', '.phtml', '.php3', '.php4', '.php5', '.php7', '.php8', '.phar', '.inc', '.asp', '.aspx', '.ashx', '.jsp', '.jspx', '.cgi', '.pl', '.py', '.rb', '.sh', '.bash', '.ps1', '.bat', '.cmd', '.exe', '.dll', '.so', '.dylib', '.jar', '.war', '.wasm', '.htaccess', '.htpasswd', '.shtml']);
const SERVER_NAMES = new Set(['.htaccess', '.htpasswd', 'web.config', '.user.ini', 'php.ini', 'Dockerfile']);
const ALLOWED_OUTSIDE_SITE = new Set(['.githooks/pre-commit']);
// ネイティブ拡張・インストール時に動く仕組み（2026-10 の testmetest ワーム：binding.gyp・.node・.napi_cache を悪用。JFrog の調査）
const NATIVE_NAMES = new Set(['binding.gyp', '.napi_cache', '.npmrc', '.yarnrc', '.yarnrc.yml']);
const NATIVE_EXT = new Set(['.node', '.gyp', '.gypi']);
// .github/ の直下に置いてよいもの（それ以外のファイル、たとえば同じワームの .github/init.js は置かない）
const GITHUB_ROOT_ALLOWED = new Set(['CODEOWNERS', 'dependabot.yml', 'pull_request_template.md']);
// 開発ツールの自動実行設定（エディタやAIツールが開いただけで命令を実行しうるもの）は置かない。
// 2026年のサプライチェーン攻撃（Mini Shai-Hulud）は .claude/ や .vscode/ に自動実行の設定を仕込んで広がった。
const TOOL_DIRS = new Set(['.claude', '.vscode', '.idea', '.cursor', '.devcontainer', '.husky', '.windsurf', '.gemini', '.codex', '.continue', '.zed', '.kiro', '.amazonq', '.roo', '.clinerules', '.mcp.json', '.cursorrules', '.windsurfrules', 'CLAUDE.md', 'GEMINI.md']);
function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (['.git', 'node_modules', '_site'].includes(name)) continue;
    // 名前の判定は大文字小文字を区別しない（大文字小文字を区別しない端末では .Claude も同じフォルダとして動くため）
    if ([...TOOL_DIRS].some((d) => d.toLowerCase() === name.toLowerCase())) {
      errors.push(`${relative(ROOT, join(dir, name)) || name}: 開発ツール・AIツールの設定はリポジトリに置かない（自動実行の設定を仕込まれるおそれ）`);
      continue;
    }
    const full = join(dir, name);
    const rel = relative(ROOT, full).split('\\').join('/');
    const st = lstatSync(full);
    // ネイティブ拡張・パッケージ設定の名前は、ファイルでもフォルダでも置かない（.napi_cache などはフォルダとしても使われうる）
    if (NATIVE_NAMES.has(name.toLowerCase()) || NATIVE_EXT.has(extname(name).toLowerCase())) {
      errors.push(`${rel}: ネイティブ拡張・パッケージ設定のファイル・フォルダは置かない（インストール時に命令を実行させる手口に使われる）`);
      continue;
    }
    if (st.isSymbolicLink()) errors.push(`${rel}: シンボリックリンクは置かない`);
    else if (st.isDirectory()) walk(full);
    else {
      if (SERVER_NAMES.has(name) || SERVER_EXT.has(extname(name).toLowerCase())) errors.push(`${rel}: サーバー側で動くファイル・実行ファイルは置かない（静的サイト）`);
      if (/^\.github\/[^/]+$/.test(rel) && !GITHUB_ROOT_ALLOWED.has(name)) errors.push(`${rel}: .github/ の直下には決まったファイル（${[...GITHUB_ROOT_ALLOWED].join('・')}）以外を置かない`);
      if ((st.mode & 0o111) && !ALLOWED_OUTSIDE_SITE.has(rel)) errors.push(`${rel}: 実行権限を付けない`);
    }
  }
}
walk(ROOT);

// 5. 画面の HTML
const REQUIRED_CSP = ["default-src 'none'", "script-src 'self'", "base-uri 'none'", "form-action 'none'", "object-src 'none'", "require-trusted-types-for 'script'"];
for (const name of readdirSync(resolve(ROOT, 'site')).filter((n) => n.endsWith('.html'))) {
  const rel = `site/${name}`;
  const html = read(rel);
  const csp = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/);
  if (!csp) errors.push(`${rel}: CSP の meta が無い`);
  else {
    for (const d of REQUIRED_CSP) if (!csp[1].includes(d)) errors.push(`${rel}: CSP に ${d} が無い`);
    if (/unsafe-inline|unsafe-eval|unsafe-hashes|\bhttps?:|\*/.test(csp[1])) errors.push(`${rel}: CSP に外部読み込み・インライン実行の許可を入れない`);
  }
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attrs = m[1];
    const isData = /type="application\/ld\+json"/.test(attrs);
    if (!isData && !/\bsrc="(?:js|vendor)\/[\w.-]+\.js"/.test(attrs)) errors.push(`${rel}: 自サイトの js/・vendor/ 以外のスクリプトは読み込まない`);
    if (!isData && m[2].trim()) errors.push(`${rel}: インラインのスクリプトは書かない`);
  }
  if (/\son[a-z]+\s*=/i.test(html.replace(/<script[\s\S]*?<\/script>/gi, ''))) errors.push(`${rel}: onclick= などのイベント属性は使わない`);
  if (/<(?:iframe|embed|object|form)\b/i.test(html)) errors.push(`${rel}: iframe / embed / object / form は使わない`);
  if (/(?:src|href)="http:/i.test(html)) errors.push(`${rel}: http:// のリンク・読み込みは使わない`);
}

// 6. 同梱ライブラリの中身（更新するときは中身を確認してから、ここの値も更新する）
const VENDOR = {
  'site/vendor/d3-array.min.js': '80aa70d0cd17dabddf6d056494ea17926a45a69da8b7850220aace331bad671d',
  'site/vendor/d3-geo.min.js': '23e574f1e8d4716d622bce45356a379b66a277162b145f5f147e4c8daefb73d2',
};
for (const [rel, hash] of Object.entries(VENDOR)) {
  const got = createHash('sha256').update(readFileSync(resolve(ROOT, rel))).digest('hex');
  if (got !== hash) errors.push(`${rel}: 確認済みの中身から変わっている（SHA-256 不一致）`);
}
for (const name of readdirSync(resolve(ROOT, 'site/vendor')))
  if (name.endsWith('.js') && !VENDOR[`site/vendor/${name}`]) errors.push(`site/vendor/${name}: 未確認のライブラリ`);

if (errors.length) {
  console.error(`repo check 失敗: ${errors.length}件`);
  for (const e of errors) console.error(' - ' + e);
  process.exit(1);
}
console.log('repo check OK');
