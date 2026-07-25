# Secure email login

OpsWorkbench supports passwordless login through short-lived, single-use links.
Password login remains an explicit recovery path until delivery has been
verified in the beta environment.

## Security properties

- Login requests always return the same generic response, whether or not the
  email belongs to an active account.
- Tokens contain 256 bits of randomness, are stored only as keyed hashes, and
  expire after 10 minutes by default. Configuration is bounded to 5–30 minutes.
- Request IPs, email identifiers, and token attempts are independently rate
  limited. New links invalidate earlier unused links for the same account.
- A token is accepted only when delivery succeeded, is consumed atomically,
  and cannot be replayed.
- Tokens use the URL fragment (`/email-login#token=...`), which browsers do not
  send in HTTP requests, access logs, or referrer headers. The SPA removes the
  fragment before exchanging the token.
- Successful exchange creates the existing HTTP-only, Secure, SameSite=Lax
  session cookie and a separate CSRF token. No authentication token is stored
  in browser local storage.
- Suspended organizations and disabled users fail closed.

## Delivery configuration

Configure a server-side HTTPS webhook:

- `CONTROL_CENTER_EMAIL_LOGIN_WEBHOOK_URL`
- `CONTROL_CENTER_EMAIL_LOGIN_WEBHOOK_TOKEN` (optional bearer credential)
- `CONTROL_CENTER_EMAIL_LOGIN_TTL_MINUTES` (default `10`, bounded `5`–`30`)

The webhook receives `to`, template `opsworkbench-secure-email-login`,
`loginUrl`, and `requestId`. It must return a successful HTTP status only after
accepting the message for delivery. The existing password-reset webhook is a
compatibility fallback, but a dedicated email-login webhook is preferred.

Do not disable the password recovery path until a real beta request has been
delivered, opened, exchanged once, rejected on replay, and recorded in the
audit log without token or URL leakage.
