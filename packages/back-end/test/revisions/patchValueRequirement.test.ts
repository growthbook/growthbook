import {
  activityLogEntryValidator,
  jsonPatchOperationValidator,
  revisionConfigTargetValidator,
} from "shared/enterprise";

// Every revision edit re-validates its stored ops, so ones saved before `value` was required must still parse.
describe("JSON-patch `value` requirement", () => {
  const valueless = { op: "replace" as const, path: "/value" };

  it("is required on incoming patch ops", () => {
    expect(jsonPatchOperationValidator.safeParse(valueless).success).toBe(
      false,
    );
    expect(
      jsonPatchOperationValidator.safeParse({ ...valueless, value: null })
        .success,
    ).toBe(true);
  });

  it("is not required on ops already stored in a revision", () => {
    const target = revisionConfigTargetValidator.shape.proposedChanges;
    expect(target.safeParse([valueless]).success).toBe(true);

    const snapshot = activityLogEntryValidator.shape.proposedChangesSnapshot;
    expect(snapshot.safeParse([valueless]).success).toBe(true);
  });
});
