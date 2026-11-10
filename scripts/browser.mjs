// Launches headless Chromium for the browser scripts, through the HTTPS_PROXY in the environment when one is set.
import net from "node:net";
import { chromium } from "playwright";

/**
 * Launches Chromium. A proxy with credentials goes through a local relay that adds them: Playwright
 * turns off the HTTP cache when it answers proxy auth itself, so requests would never revalidate with
 * ETags and API costs would read higher than in a real browser.
 */
export async function launchBrowser() {
  const env = process.env.HTTPS_PROXY || process.env.https_proxy;
  if (!env) return chromium.launch();
  const upstream = new URL(env);
  const bypass = "localhost,127.0.0.1";
  if (!upstream.username) return chromium.launch({ proxy: { server: `${upstream.protocol}//${upstream.host}`, bypass } });
  const relay = await startRelay(upstream);
  const browser = await chromium.launch({ proxy: { server: `http://127.0.0.1:${relay.port}`, bypass } });
  browser.on("disconnected", relay.close);
  return browser;
}

/** A local proxy that forwards each connection to `upstream`, adding its credentials to the first request. */
async function startRelay(upstream) {
  const auth = `Proxy-Authorization: Basic ${Buffer.from(`${decodeURIComponent(upstream.username)}:${decodeURIComponent(upstream.password)}`).toString("base64")}`;
  const sockets = new Set();
  const track = (s) => {
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
    s.on("error", () => s.destroy());
  };
  const server = net.createServer((client) => {
    track(client);
    let head = Buffer.alloc(0);
    const onData = (chunk) => {
      head = Buffer.concat([head, chunk]);
      const end = head.indexOf("\r\n\r\n");
      if (end < 0) return;
      client.off("data", onData);
      client.pause();
      const lineEnd = head.indexOf("\r\n");
      const out = net.connect(Number(upstream.port || 80), upstream.hostname, () => {
        out.write(Buffer.concat([head.subarray(0, lineEnd + 2), Buffer.from(`${auth}\r\n`), head.subarray(lineEnd + 2)]));
        client.pipe(out).pipe(client);
        client.resume();
      });
      track(out);
      out.on("close", () => client.destroy());
      client.on("close", () => out.destroy());
    };
    client.on("data", onData);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    port: server.address().port,
    close: () => {
      server.close();
      for (const s of sockets) s.destroy();
    },
  };
}
