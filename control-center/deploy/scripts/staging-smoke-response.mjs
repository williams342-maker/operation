function contentType(headers) {
  return headers?.get?.("content-type") || "missing content-type";
}

export async function responseSnapshot(response) {
  return {
    status: response.status,
    contentType: contentType(response.headers),
    text: await response.text(),
  };
}

export function parseEndpointJson(endpoint, response, { authenticated = false } = {}) {
  const type = response.contentType || "missing content-type";
  const context = authenticated ? "authenticated " : "";
  if (response.status !== 200) {
    const unauthenticated = authenticated && response.status === 401
      ? " An unauthenticated response does not validate endpoint existence."
      : "";
    const html = /^\s*<!doctype html|^\s*<html/i.test(response.text) ? " HTML fallback detected." : "";
    throw new Error(`Endpoint contract failed for ${endpoint}: expected ${context}HTTP 200 JSON, received HTTP ${response.status} ${type}.${html}${unauthenticated}`);
  }
  if (!/^application\/json\b/i.test(type)) {
    const html = /^\s*<!doctype html|^\s*<html/i.test(response.text) ? " HTML fallback detected." : "";
    throw new Error(`Endpoint contract failed for ${endpoint}: expected ${context}HTTP 200 JSON, received HTTP 200 ${type}.${html}`);
  }
  try {
    return JSON.parse(response.text);
  } catch {
    throw new Error(`Endpoint contract failed for ${endpoint}: response declared JSON but contained invalid JSON.`);
  }
}

export async function fetchEndpointJson(fetcher, endpoint, options = {}) {
  return parseEndpointJson(endpoint, await responseSnapshot(await fetcher(endpoint)), options);
}
