import { WebAuthnError } from "@simplewebauthn/browser";
import { describeWebAuthnError } from "@/services/passkeys";

const webAuthnError = (code: WebAuthnError["code"]) =>
  new WebAuthnError({ message: code, code, cause: new Error(code) });

describe("describeWebAuthnError", () => {
  it("explains a passkey that's already on this device", () => {
    expect(
      describeWebAuthnError(
        webAuthnError("ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED"),
      ),
    ).toBe("This device already has a passkey for your account.");
  });

  it("points at WEBAUTHN_RP_ID when the domain doesn't match", () => {
    for (const code of [
      "ERROR_INVALID_RP_ID",
      "ERROR_INVALID_DOMAIN",
    ] as const) {
      expect(describeWebAuthnError(webAuthnError(code))).toContain(
        "WEBAUTHN_RP_ID",
      );
    }
  });

  it("says when the device can't make a passkey that works here", () => {
    for (const code of [
      "ERROR_AUTHENTICATOR_MISSING_DISCOVERABLE_CREDENTIAL_SUPPORT",
      "ERROR_AUTHENTICATOR_MISSING_USER_VERIFICATION_SUPPORT",
    ] as const) {
      expect(describeWebAuthnError(webAuthnError(code))).toContain(
        "Try another device",
      );
    }
  });

  it("returns null for other WebAuthn errors", () => {
    expect(
      describeWebAuthnError(webAuthnError("ERROR_CEREMONY_ABORTED")),
    ).toBeNull();
  });

  it("returns null for errors that aren't from WebAuthn", () => {
    expect(describeWebAuthnError(new Error("NotAllowedError"))).toBeNull();
    expect(describeWebAuthnError("cancelled")).toBeNull();
  });
});
