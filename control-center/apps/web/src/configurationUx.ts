export type ImportedEnvironmentVariable = { name: string; value: string; secret: boolean; duplicate: boolean };

export function configurationCategory(name: string) {
  if (/(MONGO|POSTGRES|PG_|MYSQL|DATABASE|DB_)/i.test(name)) return "Database";
  if (/(R2_|S3_|AWS_|STORAGE|BUCKET|ASSET)/i.test(name)) return "Storage";
  if (/(AUTH|SESSION|JWT|OAUTH|ENTRA|AZURE|GOOGLE_CLIENT)/i.test(name)) return "Authentication";
  if (/(STRIPE|PAYPAL|PAYMENT)/i.test(name)) return "Payments";
  if (/(MAIL|EMAIL|SMTP|SENDGRID|BREVO|RESEND|POSTMARK)/i.test(name)) return "Email";
  if (/(ANALYTICS|GA4|GADS|PIXEL|SEGMENT)/i.test(name)) return "Analytics";
  if (/(OPENAI|ANTHROPIC|AI_|MODEL)/i.test(name)) return "AI";
  if (/(URL|URI|DOMAIN|ORIGIN|HOST|CALLBACK|REDIRECT)/i.test(name)) return "Domains and URLs";
  return "Custom APIs";
}

export function likelySecret(name: string) {
  return /(SECRET|TOKEN|PASSWORD|PASSWD|PRIVATE_KEY|ACCESS_KEY|API_KEY|SIGNING|CREDENTIAL|CONNECTION_STRING|DATABASE_URL|MONGO_URL|REDIS_URL)/i.test(name);
}

export function parseEnvironmentText(text: string): { variables: ImportedEnvironmentVariable[]; errors: string[] } {
  const rows = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const parsed: ImportedEnvironmentVariable[] = [];
  const errors: string[] = [];
  const counts = new Map<string, number>();
  rows.forEach((row, index) => {
    const trimmed = row.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const match = /^(?:export\s+)?([A-Z_][A-Z0-9_]{0,127})\s*=([\s\S]*)$/.exec(trimmed);
    if (!match) { errors.push(`Line ${index + 1} is not a supported VARIABLE=value entry.`); return; }
    const name = match[1];
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    counts.set(name, (counts.get(name) || 0) + 1);
    parsed.push({ name, value, secret: likelySecret(name), duplicate: false });
  });
  return { variables: parsed.map((variable) => ({ ...variable, duplicate: (counts.get(variable.name) || 0) > 1 })), errors };
}

export function plainLanguageChangeSummary(changes: Array<{ name: string; services?: string[]; secret?: boolean }>, environmentName: string) {
  const serviceNames = [...new Set(changes.flatMap((change) => change.services || []))];
  return {
    heading: `${changes.length} setting${changes.length === 1 ? "" : "s"} prepared for ${environmentName || "the selected environment"}.`,
    steps: [
      "Back up the current environment configuration.",
      "Update only the selected settings.",
      serviceNames.length ? `Restart or rebuild affected services: ${serviceNames.join(", ")}.` : "Restart or rebuild only affected services.",
      "Check the website and configured integrations.",
      "Restore the previous configuration automatically if validation fails."
    ]
  };
}
