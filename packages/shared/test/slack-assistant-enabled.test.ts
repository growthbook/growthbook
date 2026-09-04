import { resolveSlackAssistantEnabled } from "../src/validators/event-webhook";

describe("resolveSlackAssistantEnabled", () => {
  it("defaults to enabled when options or the flag are absent", () => {
    // Installs predating the setting must keep answering @mentions.
    expect(resolveSlackAssistantEnabled(undefined)).toBe(true);
    expect(resolveSlackAssistantEnabled({})).toBe(true);
  });

  it("reflects an explicit flag", () => {
    expect(resolveSlackAssistantEnabled({ assistantEnabled: true })).toBe(true);
    expect(resolveSlackAssistantEnabled({ assistantEnabled: false })).toBe(
      false,
    );
  });
});
