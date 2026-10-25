// 脆弱性が修正済みの Node.js でだけ動かす（古い Node.js で取得・検査・組み立てをしない）。
// 根拠：Node.js の 2026年10月21日のセキュリティリリース（zlib/Brotli・DNS・TLS など10件）。
//   https://nodejs.org/en/blog/vulnerability/october-2026-security-releases
// 新しいセキュリティリリースが出たら、この表の最低バージョンを上げる（運用者が更新）。
const MIN_PATCHED = { 22: [22, 23, 4], 24: [24, 22, 1], 26: [26, 12, 1] };

export function checkNode(version = process.versions.node) {
  const v = version.split('.').map((p) => (/^\d+$/.test(p) ? Number(p) : NaN));
  if (v.length !== 3 || v.some(Number.isNaN)) return `Node.js ${version} は、正式版の番号として読み取れません（22 / 24 / 26 系の正式版を使ってください）`;
  const min = MIN_PATCHED[v[0]];
  // 使ってよい系列は、この表にあるものだけ（新しい系列が出たら、確認したうえで運用者が表に追加する）
  if (!min) return `Node.js ${version} は、このプロジェクトで確認していない系列です（${Object.keys(MIN_PATCHED).join(' / ')} 系の最新版を使うか、scripts/lib/node-guard.mjs の表を更新してください）`;
  for (let i = 0; i < 3; i++) {
    if (v[i] > min[i]) return null;
    if (v[i] < min[i]) return `Node.js ${version} には修正前の脆弱性があります。${min.join('.')} 以上に更新してください`;
  }
  return null;
}

// GitHub Actions では setup-node の check-latest で毎回その系列の最新版を入れるため、警告だけにする
// （この表の値が誤っていた場合に、すべての公開が止まるのを避ける）。手元では止める。
const problem = checkNode();
if (problem && process.env.GITHUB_ACTIONS === 'true') console.log(`::warning::${problem}`);
else if (problem && process.env.TA_ALLOW_OLD_NODE !== '1') {
  console.error(problem);
  process.exit(1);
}
