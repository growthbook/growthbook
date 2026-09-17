import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { getWizardCommand } from "@/services/sdkWizard";

const selection = {
  language: "react",
  agent: "codex",
};

describe("getWizardCommand", () => {
  it("uses the default host for Cloud", () => {
    expect(getWizardCommand({ ...selection, apiHost: null })).toBe(
      "npx @growthbook/wizard --language react --codex",
    );
  });

  it.each([
    "http://localhost:3100",
    "https://api.example.com",
    "https://example.com/growthbook/",
  ])("includes the self-hosted API URL %s", (apiHost) => {
    expect(getWizardCommand({ ...selection, apiHost })).toBe(
      `npx @growthbook/wizard --language react --codex --api-host ${apiHost}`,
    );
  });

  it("preserves the selected language and agent", () => {
    expect(
      getWizardCommand({
        language: "nodejs",
        agent: "cursor",
        apiHost: "http://localhost:3100",
      }),
    ).toBe(
      "npx @growthbook/wizard --language nodejs --cursor --api-host http://localhost:3100",
    );
  });

  it("passes shell characters in the API URL as one literal argument", () => {
    const apiHost = "https://example.com/team's$tenant?one=1&two=2";
    const command = getWizardCommand({ ...selection, apiHost });
    const output = execFileSync(
      "/bin/sh",
      ["-c", `npx() { printf '%s\n' "$@"; }\n${command}`],
      { encoding: "utf8" },
    );
    expect(output.trimEnd().split("\n")).toEqual([
      "@growthbook/wizard",
      "--language",
      "react",
      "--codex",
      "--api-host",
      apiHost,
    ]);
  });
});
