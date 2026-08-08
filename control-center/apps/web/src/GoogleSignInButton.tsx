import { useEffect, useRef } from "react";
import { googleSignInStart, googleSignIn, apiError } from "./api";

// Google Identity Services is loaded on demand; only the public client_id is
// ever used in the browser (no client secret). The server issues a one-time
// nonce (bound to an httpOnly cookie) which GIS echoes into the ID token, and
// the server verifies it — replay-protecting the credential.
declare global {
  interface Window {
    google?: {
      accounts?: {
        id?: {
          initialize: (config: Record<string, unknown>) => void;
          renderButton: (el: HTMLElement, options: Record<string, unknown>) => void;
        };
      };
    };
  }
}

let gisScriptPromise: Promise<void> | null = null;
function loadGis(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve();
  if (gisScriptPromise) return gisScriptPromise;
  gisScriptPromise = new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Failed to load Google sign-in"));
    document.head.appendChild(s);
  });
  return gisScriptPromise;
}

export function GoogleSignInButton({
  onSuccess,
  onError
}: {
  onSuccess: (data: unknown) => void;
  onError?: (message: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const cfg = await googleSignInStart();
        if (!alive || !cfg.enabled || !cfg.clientId) return; // Google sign-in not configured → render nothing
        await loadGis();
        const gid = window.google?.accounts?.id;
        if (!alive || !ref.current || !gid) return;
        gid.initialize({
          client_id: cfg.clientId,
          nonce: cfg.nonce,
          callback: async (resp: { credential?: string }) => {
            if (!resp?.credential) {
              onError?.("Google sign-in was cancelled");
              return;
            }
            try {
              const data = await googleSignIn(resp.credential);
              onSuccess(data);
            } catch (e) {
              onError?.(apiError(e));
            }
          }
        });
        gid.renderButton(ref.current, { theme: "outline", size: "large", width: 280, text: "signin_with" });
      } catch (e) {
        onError?.(apiError(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, [onError, onSuccess]);

  return <div ref={ref} data-testid="google-signin-button" />;
}
