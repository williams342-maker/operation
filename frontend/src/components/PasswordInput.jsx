import React, { useState } from "react";
import { Eye, EyeOff } from "lucide-react";

/**
 * Password input with a built-in show/hide toggle (eye icon, top-right).
 *
 * Drop-in replacement for `<input type="password" />`. Forwards every prop
 * (className, value, onChange, required, autoComplete, etc.) onto the inner
 * input, so it works anywhere a regular password input does.
 *
 * Why a wrapper instead of inlining `useState` + a button in every form?
 *   - We have ≥4 password fields across the app (admin login, rotate modal,
 *     reset, set-password). Each needs the same UX. Wrapping centralizes
 *     the toggle UI + the eye SVGs + the testid pattern.
 *
 * Accessibility: the toggle is a real `<button type="button">` with an
 * aria-label that flips between "Show password" and "Hide password",
 * keyboard-focusable, and never submits the parent form.
 *
 * Test IDs:
 *   - The input keeps whatever `data-testid` is passed in (or the optional
 *     `testId` prop).
 *   - The toggle button gets `${testId}-toggle` so tests can target it.
 */
export default function PasswordInput({
  testId,
  "data-testid": dataTestId,
  className = "",
  ...rest
}) {
  const [shown, setShown] = useState(false);
  const inputId = testId || dataTestId;
  return (
    <div className="relative">
      <input
        {...rest}
        type={shown ? "text" : "password"}
        // Reserve room on the right for the icon (pr-12 = ~48px gutter).
        className={`${className} pr-12`}
        data-testid={inputId}
      />
      <button
        type="button"
        onClick={() => setShown((s) => !s)}
        aria-label={shown ? "Hide password" : "Show password"}
        title={shown ? "Hide password" : "Show password"}
        tabIndex={0}
        className="absolute top-1/2 right-3 -translate-y-1/2 p-1 text-ink-muted hover:text-brand transition"
        data-testid={inputId ? `${inputId}-toggle` : "password-toggle"}
      >
        {shown ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  );
}
