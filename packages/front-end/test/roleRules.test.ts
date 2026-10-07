import { describe, expect, it } from "vitest";
import { clearRequesterOnly } from "@/components/Settings/Team/roleRules";

describe("clearRequesterOnly", () => {
  it("returns every rule to applying always, keeping the rules", () => {
    const rule = {
      role: "engineer",
      limitAccessByEnvironment: false,
      environments: [],
    };
    const cleared = clearRequesterOnly({
      ...rule,
      requesterOnly: true,
      additionalRoles: [{ ...rule, role: "analyst", requesterOnly: true }],
      projectRoles: [
        {
          ...rule,
          project: "p1",
          requesterOnly: true,
          additionalRoles: [{ ...rule, requesterOnly: true }],
        },
      ],
    });

    expect(JSON.stringify(cleared)).not.toContain('"requesterOnly":true');
    expect(cleared.additionalRoles).toHaveLength(1);
    expect(cleared.projectRoles?.[0].additionalRoles).toHaveLength(1);
  });
});
