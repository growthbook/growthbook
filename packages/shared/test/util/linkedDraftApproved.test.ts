import { linkedDraftApproved } from "shared/util";

describe("linkedDraftApproved", () => {
  it.each([
    {
      name: "the gate's yes over a pending status",
      draftApprovalSatisfied: true,
      draftRevisionStatus: "pending-review",
      want: true,
    },
    {
      name: "the gate's no over an approved status",
      draftApprovalSatisfied: false,
      draftRevisionStatus: "approved",
      want: false,
    },
    {
      name: "an approved status without a gate answer",
      draftRevisionStatus: "approved",
      want: true,
    },
    {
      name: "any other status without a gate answer",
      draftRevisionStatus: "draft",
      want: false,
    },
    { name: "no draft at all", want: false },
  ] as const)("$name", ({ want, ...info }) => {
    expect(linkedDraftApproved(info)).toBe(want);
  });
});
