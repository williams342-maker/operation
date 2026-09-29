/* global process, fetch, AbortSignal */
import { isIP } from "node:net";
import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export function renderCloudflareRanges(v4, v6) {
  const ranges = [v4, v6].flatMap((body, index) => {
    const lines = body.trim().split(/\s+/);
    if (lines.length < 2) throw new Error("Incomplete Cloudflare address list");
    return lines.map((line) => {
      const [ip, bits, extra] = line.split("/");
      const family = index === 0 ? 4 : 6;
      if (isIP(ip) !== family || extra || !/^\d+$/.test(bits ?? "") || Number(bits) < (family === 4 ? 8 : 16) || Number(bits) > (family === 4 ? 32 : 128)) throw new Error("Invalid Cloudflare address list");
      return line;
    });
  });
  if (new Set(ranges).size !== ranges.length) throw new Error("Duplicate Cloudflare range");
  return "# Generated from https://www.cloudflare.com/ips-v4 and /ips-v6; review before installation.\n" + ranges.map((range) => `set_real_ip_from ${range};`).join("\n") + "\n";
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.argv[2]) throw new Error("Usage: node cloudflare-real-ip.mjs OUTPUT-PATH (never reloads nginx)");
  const bodies = await Promise.all([4, 6].map(async (family) => {
    const response = await fetch(`https://www.cloudflare.com/ips-v${family}`, { redirect: "error", signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error("Cloudflare range fetch failed");
    const body = await response.text();
    if (body.length > 16_384) throw new Error("Oversized Cloudflare range response");
    return body;
  }));
  await writeFile(process.argv[2], renderCloudflareRanges(...bodies), { flag: "wx", mode: 0o644 });
}
