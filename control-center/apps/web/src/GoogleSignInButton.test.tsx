import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ googleSignInStart: vi.fn(), googleSignIn: vi.fn() }));
vi.mock("./api", () => ({
  googleSignInStart: mocks.googleSignInStart,
  googleSignIn: mocks.googleSignIn,
  apiError: (error: unknown) => (error instanceof Error ? error.message : "error")
}));

import { GoogleSignInButton } from "./GoogleSignInButton";

// The same shape as the sign-in form: the field state lives in the parent, and the parent passes a
// fresh inline callback on every render.
function SignInLike({ onError }: { onError: (message: string) => void }) {
  const [email, setEmail] = useState("");
  return (
    <div>
      <GoogleSignInButton onSuccess={() => undefined} onError={onError} />
      <input aria-label="Email" value={email} onChange={(event) => setEmail(event.target.value)} />
    </div>
  );
}

describe("GoogleSignInButton", () => {
  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  it("asks the server for its configuration once per mount, however often the parent re-renders", async () => {
    mocks.googleSignInStart.mockResolvedValue({ enabled: false });
    render(<SignInLike onError={() => undefined} />);
    await userEvent.type(screen.getByLabelText("Email"), "someone@example.test");
    await waitFor(() => expect(mocks.googleSignInStart).toHaveBeenCalled());
    expect(mocks.googleSignInStart).toHaveBeenCalledTimes(1);
  });

  it("reports a failed start through the latest onError without starting again", async () => {
    mocks.googleSignInStart.mockRejectedValue(new Error("Too many authentication attempts"));
    const first = vi.fn(); const latest = vi.fn();
    const { rerender } = render(<GoogleSignInButton onSuccess={() => undefined} onError={first} />);
    rerender(<GoogleSignInButton onSuccess={() => undefined} onError={latest} />);
    await waitFor(() => expect(latest).toHaveBeenCalledWith("Too many authentication attempts"));
    expect(first).not.toHaveBeenCalled();
    expect(mocks.googleSignInStart).toHaveBeenCalledTimes(1);
  });
});
