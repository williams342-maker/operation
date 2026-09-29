import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { renderCloudflareRanges } from "./cloudflare-real-ip.mjs";

test("Cloudflare list rendering validates both families and rejects incomplete or injected configuration", () => {
  const v4 = "173.245.48.0/20\n103.21.244.0/22", v6 = "2400:cb00::/32\n2606:4700::/32";
  assert.match(renderCloudflareRanges(v4, v6), /set_real_ip_from 2400:cb00::\/32;/);
  for (const bad of ["", "<html>error</html>", "0.0.0.0/0\n103.21.244.0/22", `${v4}\ninclude /secrets;`, "173.245.48.0/20\n173.245.48.0/20"]) assert.throws(() => renderCloudflareRanges(bad, v6));
  assert.throws(() => renderCloudflareRanges(v4, v4));
});

test("checked-in Cloudflare trust contains only validated explicit published ranges", async () => {
  const text = await readFile(new URL("../nginx/cloudflare-real-ip.conf", import.meta.url), "utf8");
  const lines = text.split(/\r?\n/).filter((line) => line && !line.startsWith("#"));
  const ranges = lines.map((line) => { assert.match(line, /^set_real_ip_from [0-9a-f.:]+\/\d+;$/); return line.slice(17, -1); });
  assert.equal(ranges.length, 22);
  renderCloudflareRanges(ranges.filter((r) => !r.includes(":")).join("\n"), ranges.filter((r) => r.includes(":")).join("\n"));
});
