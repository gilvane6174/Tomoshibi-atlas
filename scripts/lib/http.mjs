// 取得処理の共通部分。リダイレクトは追わない（別ホストへ誘導されるのを防ぐ）。
// サイズ上限と時間制限を設け、超えたら失敗させる。認証情報は一切送らない。

const MAX_BYTES = 15 * 1024 * 1024;

export async function fetchText(url, { timeoutMs = 30000 } = {}) {
  const res = await fetch(url, {
    redirect: 'error',
    signal: AbortSignal.timeout(timeoutMs),
    headers: { Accept: 'application/json, application/xml, text/xml;q=0.9, */*;q=0.1', 'User-Agent': 'tomoshibi-atlas-build' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  const declared = Number(res.headers.get('content-length') || 0);
  if (declared > MAX_BYTES) throw new Error(`too large (${declared} bytes) ${url}`);
  // 受信しながら大きさを数え、上限を超えた時点で打ち切る（Content-Length の無い応答にも対応）
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel();
      throw new Error(`too large (> ${MAX_BYTES} bytes) ${url}`);
    }
    chunks.push(value);
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
}

export async function fetchJson(url, opts) {
  const text = await fetchText(url, opts);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`invalid JSON ${url}`);
  }
}
