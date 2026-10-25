// ローカル確認用の簡易サーバー。自分のPCからしか接続できない（127.0.0.1 に限定）。
// 使い方: node scripts/build.mjs --offline && node scripts/serve.mjs  → http://127.0.0.1:8080/
// 本番（GitHub Pages）では使わない。

import './lib/node-guard.mjs';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { ROOT } from './lib/safety.mjs';

const DIR = resolve(ROOT, '_site');
const PORT = Number(process.env.PORT || 8080);
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
};

createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let file = resolve(DIR, '.' + (path.endsWith('/') ? path + 'index.html' : path));
    if (!file.startsWith(DIR + sep)) throw new Error('outside'); // ディレクトリ外への到達を拒否
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file)] || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'X-Frame-Options': 'DENY',
      'Cache-Control': 'no-store',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('not found');
  }
}).listen(PORT, '127.0.0.1', () => console.log(`http://127.0.0.1:${PORT}/`));
