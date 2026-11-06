// Static file server for the built app: SPA fallback, compression, and strict security headers.
// Usage: node server/serve.mjs [--port 8080] [--host 127.0.0.1] [--dir dist] [--cert cert.pem --key key.pem]
// With --cert and --key it serves HTTPS.
import { readFileSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { brotliCompressSync, gzipSync } from "node:zlib";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const PORT = Number(args.port ?? process.env.PORT ?? 8080);
const HOST = args.host ?? process.env.HOST ?? "127.0.0.1";
const ROOT = resolve(args.dir ?? new URL("../dist", import.meta.url).pathname);
const CERT = args.cert ?? process.env.TLS_CERT;
const KEY = args.key ?? process.env.TLS_KEY;
if (!CERT !== !KEY) {
  console.error(`Failed to start: --cert and --key must be given together (cert: ${CERT ?? "none"}, key: ${KEY ?? "none"})`);
  process.exit(1);
}
const TLS = CERT ? { cert: readFileSync(CERT), key: readFileSync(KEY) } : null;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".map": "application/json",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
  ".txt": "text/plain; charset=utf-8",
};

const IMG_HOSTS = "https://*.githubusercontent.com https://github.com https://*.github.com https://*.githubassets.com";
export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${IMG_HOSTS}`,
  `media-src 'self' ${IMG_HOSTS}`,
  "connect-src 'self' https://api.github.com",
  "worker-src 'self' blob:",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

const SECURITY_HEADERS = {
  "Content-Security-Policy": CSP,
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  ...(TLS ? { "Strict-Transport-Security": "max-age=31536000" } : {}),
};

const cache = new Map();

async function load(path) {
  let entry = cache.get(path);
  if (entry) return entry;
  const body = await readFile(path);
  const type = TYPES[extname(path)] ?? "application/octet-stream";
  const compressible = /text|javascript|json|svg/.test(type) && body.length > 1024;
  entry = {
    body,
    type,
    br: compressible ? brotliCompressSync(body) : null,
    gz: compressible ? gzipSync(body) : null,
  };
  cache.set(path, entry);
  return entry;
}

async function resolveFile(urlPath) {
  const safe = normalize(decodeURIComponent(urlPath)).replace(/^(\.\.[/\\])+/, "");
  const file = join(ROOT, safe);
  if (!file.startsWith(ROOT)) return null;
  try {
    if ((await stat(file)).isFile()) return file;
  } catch {
    // Fall through to the SPA entry point.
  }
  return null;
}

async function handle(req, res) {
  try {
    const url = new URL(req.url ?? "/", "http://x");
    // Page navigations fall back to the SPA, including repo paths with dots like /vercel/next.js.
    const isPage = !extname(url.pathname) || String(req.headers.accept ?? "").includes("text/html");
    const file = (await resolveFile(url.pathname)) ?? (isPage ? join(ROOT, "index.html") : null);
    if (!file) {
      res.writeHead(404, SECURITY_HEADERS).end("Not found");
      return;
    }
    const entry = await load(file);
    const accept = String(req.headers["accept-encoding"] ?? "");
    const headers = {
      ...SECURITY_HEADERS,
      "Content-Type": entry.type,
      "Cache-Control": url.pathname.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache",
      Vary: "Accept-Encoding",
    };
    let body = entry.body;
    if (entry.br && accept.includes("br")) {
      body = entry.br;
      headers["Content-Encoding"] = "br";
    } else if (entry.gz && accept.includes("gzip")) {
      body = entry.gz;
      headers["Content-Encoding"] = "gzip";
    }
    res.writeHead(200, headers);
    res.end(req.method === "HEAD" ? undefined : body);
  } catch (e) {
    res.writeHead(500, SECURITY_HEADERS).end(`Failed to serve ${req.url}: ${e.message}`);
  }
}

const server = TLS ? createHttpsServer(TLS, handle) : createHttpServer(handle);
server.listen(PORT, HOST, () => console.log(`gitgud serving ${ROOT} on ${TLS ? "https" : "http"}://${HOST}:${PORT}`));
