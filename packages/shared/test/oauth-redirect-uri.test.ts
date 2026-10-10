import {
  isSafeOAuthRedirectUri,
  oauthDcrRequestValidator,
} from "../src/validators/oauth";

describe("isSafeOAuthRedirectUri", () => {
  it.each([
    "https://client.example.com/cb",
    "http://localhost:8787/callback",
    "cursor://anysphere.cursor-retrieval/oauth/callback",
    "com.example.app:/oauth2redirect",
  ])("allows %s", (uri) => {
    expect(isSafeOAuthRedirectUri(uri)).toBe(true);
  });

  it.each([
    "javascript:alert(1)//",
    "JavaScript:alert(1)//",
    " javascript:alert(1)//",
    "java\tscript:alert(1)//",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    "file:///etc/passwd",
    "blob:https://evil.example/uuid",
    "about:blank",
    "not a url",
  ])("rejects %j", (uri) => {
    expect(isSafeOAuthRedirectUri(uri)).toBe(false);
  });
});

describe("oauthDcrRequestValidator", () => {
  it("rejects registration with a javascript: redirect URI", () => {
    const result = oauthDcrRequestValidator.safeParse({
      redirect_uris: ["https://ok.example/cb", "javascript:alert(1)//"],
    });
    expect(result.success).toBe(false);
  });
});
