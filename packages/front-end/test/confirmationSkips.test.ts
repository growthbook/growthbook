import { describe, expect, it } from "vitest";
import type { ConfirmAction, ConfirmationNotice } from "shared/validators";
import {
  isPolicySkip,
  skipSeverity,
  skipsOf,
} from "@/components/Confirmations/skips";

const notice = (
  via: ConfirmationNotice["via"],
  message: string,
  severity: ConfirmationNotice["severity"] = "warning",
): ConfirmationNotice => ({ severity, messages: [message], via });

const refusal = notice(null, "Refused last time");
const warning = notice("ignoreWarnings", "Experiment guard");
const hook = notice("skipHooks", "Hook rejected", "error");
const approval = notice("bypassApprovalPermission", "Needs approval");
const reverts = notice("revertsBypassApproval", "Revert without approval");

const actionsOf = (overrides: ConfirmAction[], notices: ConfirmationNotice[]) =>
  skipsOf(overrides, [], notices).map((skip) => skip.action);

describe("skipsOf", () => {
  it("keeps every notice exactly once and every override", () => {
    const notices = [refusal, warning, hook, approval, reverts];
    const overrides: ConfirmAction[] = [
      "override.ignoreWarnings",
      "override.skipHooks",
      "override.bypassApproval",
      "override.restBypassesReviews",
      "override.unscopedRules",
    ];
    const skips = skipsOf(overrides, ["override.unscopedRules"], notices);
    expect(skips.flatMap((skip) => skip.notices)).toHaveLength(notices.length);
    expect(new Set(skips.flatMap((skip) => skip.notices))).toEqual(
      new Set(notices),
    );
    expect(skips.map((skip) => skip.action)).toEqual([...overrides, null]);
  });

  it("files a refusal under the one flag the retry sent", () => {
    const skips = skipsOf(
      ["override.unscopedRules"],
      ["override.unscopedRules"],
      [refusal],
    );
    expect(skips).toEqual([
      { action: "override.unscopedRules", notices: [refusal], policy: null },
    ]);
  });

  it("leaves a refusal on its own when the flag is ambiguous or wasn't sent", () => {
    const two: ConfirmAction[] = [
      "override.unscopedRules",
      "override.draftLimit",
    ];
    expect(skipsOf(two, two, [refusal]).map((skip) => skip.action)).toEqual([
      ...two,
      null,
    ]);
    expect(actionsOf(two, [refusal])).toEqual([...two, null]);
    expect(
      skipsOf(["override.restBypassesReviews"], [], [refusal]).map(
        (skip) => skip.action,
      ),
    ).toEqual(["override.restBypassesReviews", null]);
  });

  it("keeps a notice whose override isn't held, as before", () => {
    expect(skipsOf([], [], [warning])).toEqual([
      { action: null, notices: [warning], policy: null },
    ]);
  });
});

describe("isPolicySkip and skipSeverity", () => {
  it("files bypasses by authority or org setting under policies", () => {
    const skips = skipsOf(
      [
        "override.bypassApproval",
        "override.restBypassesReviews",
        "override.unscopedRules",
      ],
      ["override.unscopedRules"],
      [approval, reverts, refusal],
    );
    expect(skips.map(isPolicySkip)).toEqual([true, true, false, true]);
  });

  it("files an override the request didn't send under the policy that grants it", () => {
    const [held] = skipsOf(["override.bypassApproval"], [], []);
    expect(held.policy).toBe("bypassApprovalPermission");
    expect(isPolicySkip(held)).toBe(true);
    const [sent] = skipsOf(
      ["override.bypassApproval"],
      ["override.bypassApproval"],
      [],
    );
    expect(isPolicySkip(sent)).toBe(false);
    const [checklist] = skipsOf(["override.skipChecklist"], [], []);
    expect(isPolicySkip(checklist)).toBe(false);
  });

  it("shows an error when any message is one", () => {
    expect(
      skipSeverity({ action: null, notices: [warning, hook], policy: null }),
    ).toBe("error");
    expect(
      skipSeverity({
        action: "override.draftLimit",
        notices: [],
        policy: null,
      }),
    ).toBe("warning");
  });
});
