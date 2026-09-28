/* global process, fetch, setTimeout */
import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import { once } from "node:events";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { URL } from "node:url";

// Runs a disposable real nginx process. Does not read/modify an installed nginx config.
const binary = process.env.NGINX_BINARY || "nginx";
const version = spawnSync(binary, ["-v"], { encoding: "utf8", windowsHide: true });
if (version.status !== 0) throw new Error("Set NGINX_BINARY to a real nginx executable (required, no simulated pass)");
const root = await mkdtemp(join(tmpdir(), "q4-nginx-"));
await mkdir(join(root, "logs"));
await mkdir(join(root, "temp"));
const echo = createServer((req, res) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(req.headers)); });
echo.listen(0, "127.0.0.1"); await once(echo, "listening");
const echoPort = echo.address().port;
async function port() { const s = createServer(); s.listen(0, "127.0.0.1"); await once(s, "listening"); const n = s.address().port; await new Promise((r) => s.close(r)); return n; }
const hostPort = await port(), edgePort = await port(), adminPort = await port();
const hostSource = await readFile(new URL("../nginx/staging.conf", import.meta.url), "utf8");
const edgeSource = await readFile(new URL("../nginx/edge-container.conf", import.meta.url), "utf8");
const adminSource = await readFile(new URL("../nginx/admin-web.conf", import.meta.url), "utf8");
const adminHeaders = adminSource.split(/\r?\n/).filter((line) => /^\s*proxy_set_header /.test(line)).join("\n");
const headers = hostSource.split(/\r?\n/).filter((line) => /^\s*proxy_set_header /.test(line)).join("\n").replaceAll("$request_id_forwarded", "$request_id");
const realip = hostSource.split(/\r?\n/).filter((line) => /^\s*real_ip_/.test(line)).join("\n");
assert.match(hostSource, /include \/etc\/nginx\/cloudflare-real-ip.conf;/);
const edge = edgeSource.replace("listen 8080;", `listen 127.0.0.1:${edgePort};`).replaceAll("http://api:3000", `http://127.0.0.1:${echoPort}`).replaceAll("http://web:8080", `http://127.0.0.1:${echoPort}`);
let assertions = 0;
async function run(mutation) {
  const forwarding = mutation === "append-xff" ? headers.replace("X-Forwarded-For $remote_addr", "X-Forwarded-For $proxy_add_x_forwarded_for") : headers;
  const authority = mutation === "remove-real-ip" ? "" : realip;
  const config = `daemon off; master_process off; pid logs/nginx.pid; error_log logs/error.log; events { worker_connections 64; } http {
    access_log off;
    limit_req_zone $binary_remote_addr zone=q4:1m rate=1r/s;
    server { listen 127.0.0.1:${hostPort}; set_real_ip_from 127.0.0.1; ${authority}
      ${forwarding}
      location / { proxy_pass http://127.0.0.1:${edgePort}; }
      location /admin/ { proxy_pass http://127.0.0.1:${adminPort}/api/; }
      location /limited { limit_req zone=q4; proxy_pass http://127.0.0.1:${edgePort}; }
    }
    ${edge}
    server { listen 127.0.0.1:${adminPort}; location /api/ { ${adminHeaders} proxy_pass http://127.0.0.1:${echoPort}; } }
  }`;
  await writeFile(join(root, "nginx.conf"), config);
  const args = ["-p", root.replaceAll("\\", "/") + "/", "-c", "nginx.conf"];
  const checked = spawnSync(binary, [...args, "-t"], { cwd: root, encoding: "utf8", windowsHide: true });
  assert.equal(checked.status, 0, checked.stderr);
  const child = spawn(binary, args, { cwd: root, stdio: "ignore", windowsHide: true });
  try {
    for (let i = 0; i < 50; i++) { try { await fetch(`http://127.0.0.1:${hostPort}/readyz`); break; } catch { await new Promise((r) => setTimeout(r, 20)); } }
    const send = async (ip, path = "/api/echo", localAddress) => {
      return await new Promise((resolveResponse, reject) => {
        const req = request({ host: "127.0.0.1", port: hostPort, path, localAddress, headers: { "CF-Connecting-IP": ip, "X-Forwarded-For": "203.0.113.99", "X-Real-IP": "203.0.113.98", Forwarded: "for=203.0.113.97" } }, (res) => { let body = ""; res.on("data", (part) => body += part); res.on("end", () => resolveResponse({ status: res.statusCode, body: res.statusCode === 200 ? JSON.parse(body) : {} })); }); req.on("error", reject); req.end();
      });
    };
    for (const path of ["/api/echo", "/healthz", "/readyz", "/admin/echo"]) {
      const r = await send("198.51.100.7", path);
      assert.equal(r.body["x-forwarded-for"], "198.51.100.7, 127.0.0.1");
      assert.equal(r.body["x-real-ip"], "198.51.100.7");
      assert.equal(r.body["cf-connecting-ip"], "198.51.100.7");
      assert.equal(r.body.forwarded, undefined); assertions++;
    }
    assert.equal((await send("2001:db8::5")).body["x-forwarded-for"], "2001:db8::5, 127.0.0.1"); assertions++;
    assert.equal((await send("203.0.113.7", "/api/echo", "127.0.0.2")).body["x-forwarded-for"], "127.0.0.2, 127.0.0.1"); assertions++;
    assert.equal((await send("198.51.100.20", "/limited")).status, 200);
    assert.equal((await send("198.51.100.20", "/limited")).status, 503);
    assert.equal((await send("198.51.100.21", "/limited")).status, 200); assertions++;
  } finally { child.kill(); await once(child, "exit"); }
}
try {
  await run();
  let killed = 0;
  for (const mutation of ["remove-real-ip", "append-xff"]) {
    try { await run(mutation); } catch (error) { if (error.code !== "ERR_ASSERTION") throw error; killed++; }
  }
  assert.equal(killed, 2, "Both trust-anchor mutations must fail the behavioral assertions");
  process.stdout.write(JSON.stringify({ nginx: version.stderr.trim(), pass: assertions, fail: 0, mutationsKilled: killed }) + "\n");
} finally {
  echo.closeAllConnections(); await new Promise((r) => echo.close(r));
  await rm(resolve(root), { recursive: true, force: true });
}
