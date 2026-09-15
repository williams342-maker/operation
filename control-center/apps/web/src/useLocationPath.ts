import { useEffect, useState } from "react";

// Minimal History-API location hook. Foundry needs real, shareable URLs
// (/foundry, /foundry/new, /foundry/projects/:id) without adding a router library
// to the shell. Returns the current pathname and a navigate() that pushes state
// and updates subscribers; back/forward work via popstate.
export function useLocationPath(): [string, (path: string) => void] {
  const [path, setPath] = useState(() => (typeof window !== "undefined" ? window.location.pathname : "/"));
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const navigate = (next: string) => {
    if (typeof window !== "undefined" && next !== window.location.pathname) {
      window.history.pushState({}, "", next);
    }
    setPath(next);
  };
  return [path, navigate];
}
