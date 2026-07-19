import { URL } from "node:url";

const resourceErrorPattern = /^Failed to load resource: the server responded with a status of (\d{3}) \([^)]+\)$/;

export function createBrowserErrorTracker(expectations) {
  for (const item of expectations) {
    if (!item.phase || !item.method || !item.path?.startsWith("/") || !Number.isInteger(item.status) || !Number.isInteger(item.count) || item.count < 1) {
      throw new Error("Invalid expected browser response declaration");
    }
  }

  let phase = "unscoped";
  const expected = expectations.map((item) => ({ ...item, responses: 0 }));
  const unexpectedResponses = [];
  const unexpectedConsoleErrors = [];
  const resourceConsoleErrors = [];

  return {
    setPhase(value) { phase = value; },
    response({ method, url, status }) {
      if (status < 400) return;
      const path = new URL(url).pathname;
      const match = expected.find((item) =>
        item.phase === phase && item.method === method && item.path === path && item.status === status && item.responses < item.count);
      if (match) match.responses += 1;
      else unexpectedResponses.push({ phase, method, path, status });
    },
    console({ type, text }) {
      if (type !== "error") return;
      const resource = resourceErrorPattern.exec(text);
      const status = resource ? Number(resource[1]) : null;
      if (status === null) unexpectedConsoleErrors.push({ phase, text });
      else resourceConsoleErrors.push({ phase, status, text });
    },
    result() {
      const consoleCounts = new Map(expected.map((item) => [item, 0]));
      const unmatchedResourceErrors = resourceConsoleErrors.filter((error) => {
        const match = expected.find((item) =>
          item.phase === error.phase && item.status === error.status && consoleCounts.get(item) < item.responses);
        if (!match) return true;
        consoleCounts.set(match, consoleCounts.get(match) + 1);
        return false;
      });
      return {
        unmet: expected.filter((item) => item.responses !== item.count || consoleCounts.get(item) !== item.count),
        unexpectedResponses,
        unexpectedConsoleErrors: [...unexpectedConsoleErrors, ...unmatchedResourceErrors.map(({ phase, text }) => ({ phase, text }))],
      };
    },
  };
}
