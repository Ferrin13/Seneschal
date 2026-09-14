import { describe, expect, it } from "vitest";
import { isDeadTokenError } from "../src/push/tokenErrors.js";

describe("isDeadTokenError", () => {
  it("treats unregistered / invalid-token codes as dead", () => {
    expect(
      isDeadTokenError(
        "messaging/registration-token-not-registered",
        "Requested entity was not found."
      )
    ).toBe(true);
    expect(isDeadTokenError("messaging/invalid-registration-token", "")).toBe(
      true
    );
  });

  it("only treats invalid-argument as dead when it is about the token", () => {
    expect(
      isDeadTokenError(
        "messaging/invalid-argument",
        "The registration token is not a valid FCM registration token"
      )
    ).toBe(true);
    // Same code for a bad *message* — must not prune every device.
    expect(
      isDeadTokenError(
        "messaging/invalid-argument",
        "Request contains an invalid argument: data payload exceeds 4096 bytes"
      )
    ).toBe(false);
    expect(isDeadTokenError("messaging/invalid-argument", undefined)).toBe(
      false
    );
  });

  it("keeps tokens on transient or unknown failures", () => {
    expect(isDeadTokenError("messaging/internal-error", "x")).toBe(false);
    expect(isDeadTokenError("messaging/quota-exceeded", "x")).toBe(false);
    expect(isDeadTokenError("messaging/unavailable", "x")).toBe(false);
    expect(isDeadTokenError(undefined, "x")).toBe(false);
  });
});
