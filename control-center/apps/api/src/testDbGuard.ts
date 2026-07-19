export function assertSafeTestMongoUrl(raw = process.env.MONGO_URL_TEST || "") {
  if (process.env.CONTROL_CENTER_RUN_DB_TESTS !== "true") {
    throw new Error("Set CONTROL_CENTER_RUN_DB_TESTS=true to run database integration tests");
  }
  const url = new URL(raw);
  const host = url.hostname.toLowerCase();
  const dbName = url.pathname.replace(/^\//, "").toLowerCase();
  const blockedHosts = ["production.example.invalid", "live.example.invalid"];
  const blockedDb = /(^|[-_])(prod|production|live)([-_]|$)/;
  if (blockedHosts.some((blocked) => host.includes(blocked))) throw new Error("MONGO_URL_TEST points at a blocked production-like host");
  if (!dbName || blockedDb.test(dbName)) throw new Error("MONGO_URL_TEST must use an isolated non-production database name");
  if (!dbName.startsWith("control_center_test")) throw new Error("MONGO_URL_TEST database name must begin with control_center_test");
  return raw;
}
export function isolatedTestMongoUrl(raw = process.env.MONGO_URL_TEST || "", suffix = `${Date.now()}_${Math.random().toString(16).slice(2)}`) {
  assertSafeTestMongoUrl(raw);
  const url = new URL(raw);
  const dbName = `control_center_test_${suffix.replace(/[^a-zA-Z0-9_]/g, "_")}`;
  url.pathname = `/${dbName}`;
  return { url: url.toString(), dbName };
}
