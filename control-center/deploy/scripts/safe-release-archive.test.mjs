import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import test from "node:test";
import { inspectReleaseTarGz } from "../../scripts/safe-release-archive.mjs";

const block = (name, type = "0", body = Buffer.alloc(0)) => {
  const header = Buffer.alloc(512); header.write(name, 0, 100, "utf8");
  header.write("0000644\0", 100); header.write("0000000\0", 108); header.write("0000000\0", 116);
  header.write(`${body.length.toString(8).padStart(11, "0")}\0`, 124); header.write("00000000000\0", 136);
  header.fill(0x20, 148, 156); header[156] = type.charCodeAt(0); header.write("ustar\0", 257); header.write("00", 263);
  header.write(`${header.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, "0")}\0 `, 148);
  return Buffer.concat([header, body, Buffer.alloc((512 - (body.length % 512)) % 512)]);
};
const archive = (...members) => zlib.gzipSync(Buffer.concat([...members, Buffer.alloc(1024)]));
const fixture = (bytes) => { const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "safe-release-")), "x.tar.gz"); fs.writeFileSync(file, bytes); return file; };

test("accepts canonical regular files and directories under one prefix", () => {
  const result = inspectReleaseTarGz(fixture(archive(block("release/", "5"), block("release/file", "0", Buffer.from("ok")))), { expectedPrefix: "release" });
  assert.deepEqual([...result.members.keys()], ["release", "release/file"]);
});

for (const [name, member, pattern] of [
  ["absolute", block("/etc/passwd"), /unsafe/], ["traversal", block("release/../escape"), /non-canonical/],
  ["symlink", block("release/link", "2"), /forbidden type/], ["hardlink", block("release/link", "1"), /forbidden type/],
  ["device", block("release/dev", "3"), /forbidden type/], ["fifo", block("release/fifo", "6"), /forbidden type/],
]) test(`refuses ${name}`, () => assert.throws(() => inspectReleaseTarGz(fixture(archive(member)), { expectedPrefix: "release" }), pattern));

test("refuses duplicate names and an unexpected top-level prefix", () => {
  assert.throws(() => inspectReleaseTarGz(fixture(archive(block("release/x"), block("release/x"))), { expectedPrefix: "release" }), /duplicated/);
  assert.throws(() => inspectReleaseTarGz(fixture(archive(block("other/x"))), { expectedPrefix: "release" }), /top-level/);
});

test("accepts only Git's commit-bound global PAX header", () => {
  const body = Buffer.from("52 comment=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n");
  const result = inspectReleaseTarGz(fixture(archive(block("pax_global_header", "g", body), block("release/x"))), { expectedPrefix: "release" });
  assert.equal(result.archiveCommit, "a".repeat(40));
  assert.throws(() => inspectReleaseTarGz(fixture(archive(block("pax_global_header", "g", Buffer.from("12 path=x\n")), block("release/x"))), { expectedPrefix: "release" }), /exact Git commit/);
});
