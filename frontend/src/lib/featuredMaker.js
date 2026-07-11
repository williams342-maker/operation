/** iter455 — cached public featured-maker fetch shared across surfaces. */
import { http } from "./api";

let promise = null;
export function getFeaturedMaker() {
  if (!promise) {
    promise = http.get("/featured-maker")
      .then((r) => r.data.featured)
      .catch(() => null);
  }
  return promise;
}

export function daysRemaining(endsAt) {
  if (!endsAt) return 0;
  return Math.max(0, Math.ceil((new Date(endsAt) - Date.now()) / 86400000));
}
