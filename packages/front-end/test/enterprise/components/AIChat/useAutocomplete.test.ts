import { completePrefix } from "shared/ai-chat";
import {
  remainingCompletion,
  suggestedReplyFromOptions,
} from "@/enterprise/components/AIChat/Composer/useAutocomplete";

const s = { base: "create a flag", completion: " for checkout" };

describe("remainingCompletion", () => {
  it("shows the whole completion for the draft it was made for", () => {
    expect(remainingCompletion("create a flag", s)).toBe(" for checkout");
  });
  it("narrows as the user types into it", () => {
    expect(remainingCompletion("create a flag for ch", s)).toBe("eckout");
  });
  it("drops it when the draft diverges or shrinks", () => {
    expect(remainingCompletion("create a flag fo r", s)).toBe("");
    expect(remainingCompletion("create a fl", s)).toBe("");
    expect(remainingCompletion("create a flag", null)).toBe("");
  });
  it("ignores an empty completion", () => {
    expect(remainingCompletion("create a flag", { ...s, completion: "" })).toBe(
      "",
    );
  });
});

describe("suggestedReplyFromOptions", () => {
  const reply = [
    "Could you clarify which AI feature you want to turn off? For example:",
    "",
    "- A specific feature flag related to AI?",
    "- An AI feature in GrowthBook itself (like this AI assistant)?",
    "- Something else?",
    "",
    "Once you let me know, I can guide you through the steps.",
  ].join("\n");

  it("takes the first option word for word, minus the question mark", () => {
    expect(suggestedReplyFromOptions(reply)).toBe(
      "A specific feature flag related to AI",
    );
  });
  it("prefers the option the agent marked as recommended, tag removed", () => {
    expect(
      suggestedReplyFromOptions(
        "- The checkout experiment\n- The onboarding experiment (recommended)\n- Something else",
      ),
    ).toBe("The onboarding experiment");
  });
  it("skips generic options and handles numbered lists", () => {
    expect(
      suggestedReplyFromOptions(
        "Which one?\n1. Something else\n2. The checkout experiment",
      ),
    ).toBe("The checkout experiment");
  });
  it("ignores bulleted results that weren't offered as choices", () => {
    expect(
      suggestedReplyFromOptions(
        "Here are last week's numbers:\n- Revenue: $12,400\n- Orders: 318\n\nAnything else?",
      ),
    ).toBeUndefined();
  });
  it("returns nothing when the message has no options", () => {
    expect(suggestedReplyFromOptions("Done. Anything else?")).toBeUndefined();
  });
});

describe("completePrefix", () => {
  const prompts = [
    "Help me create a Feature Flag",
    "Help me create an experiment",
  ];

  it("finishes the first prompt the draft is a prefix of, case-insensitively", () => {
    expect(completePrefix("help me create", prompts)).toBe(" a Feature Flag");
    expect(completePrefix("Help me create an", prompts)).toBe(" experiment");
  });
  it("needs a real prefix", () => {
    expect(completePrefix("show me", prompts)).toBeUndefined();
    expect(
      completePrefix("Help me create a Feature Flag", prompts),
    ).toBeUndefined();
  });
});
