import { useEffect, useState } from "react";
import { fetchSiteSettings } from "../lib/api";

const REFRESH_MS = 60000; // poll every 60s so admin-toggled flags propagate

let _cache = null;
let _listeners = new Set();

const notify = () => _listeners.forEach((fn) => fn(_cache));

const load = async () => {
  try {
    const s = await fetchSiteSettings();
    _cache = s;
    notify();
  } catch {
    // Silent — keep last-good cache so a transient outage doesn't black-box the site.
  }
};

let _interval = null;
const ensurePolling = () => {
  if (_interval) return;
  load();
  _interval = setInterval(load, REFRESH_MS);
};

export function useSiteSettings() {
  const [settings, setSettings] = useState(_cache);
  useEffect(() => {
    _listeners.add(setSettings);
    ensurePolling();
    return () => { _listeners.delete(setSettings); };
  }, []);
  return settings;
}

export function refreshSiteSettings() {
  return load();
}
