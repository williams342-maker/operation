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
  // The callbacks are read through refs so the effect runs once per mount. With them as effect
  // dependencies, a parent passing an inline callback re-ran it on every render -- every keystroke in the
  // sign-in form -- and each run called /auth/google/start, spending the shared authentication rate-limit
  // budget and replacing the nonce cookie that Google Identity Services had already been initialized with.
  const onSuccessRef = useRef(onSuccess);
  const onErrorRef = useRef(onError);
  onSuccessRef.current = onSuccess;
  onErrorRef.current = onError;

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
              onErrorRef.current?.("Google sign-in was cancelled");
              return;
            }
            try {
              const data = await googleSignIn(resp.credential);
              onSuccessRef.current(data);
            } catch (e) {
              onErrorRef.current?.(apiError(e));
            }
          }
        });
        gid.renderButton(ref.current, { theme: "outline", size: "large", width: 280, text: "signin_with" });
      } catch (e) {
        onErrorRef.current?.(apiError(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  return <div ref={ref} data-testid="google-signin-button" />;
}
