import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { URL } from "node:url";

const releaseRoot = "/release";
const tls = {
  cert: fs.readFileSync("/etc/opsworkbench-fixture/release.crt"),
  key: fs.readFileSync("/etc/opsworkbench-fixture/release.key"),
};

function safeArtifact(url) {
  const name = decodeURIComponent(new URL(url, "https://127.0.0.1").pathname.slice(1));
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]+$/.test(name)) return undefined;
  const file = path.join(releaseRoot, name);
  return path.dirname(file) === releaseRoot && fs.existsSync(file) && fs.statSync(file).isFile() ? file : undefined;
}

https.createServer(tls, (request, response) => {
  const file = safeArtifact(request.url || "/");
  if (!file) {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, { "content-length": fs.statSync(file).size, "content-type": "application/octet-stream" });
  fs.createReadStream(file).pipe(response);
}).listen(8443, "127.0.0.1");

http.createServer((request, response) => {
  request.resume();
  request.on("end", () => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ serverId: "fixture-server", tasks: [] }));
  });
}).listen(18000, "127.0.0.1");
