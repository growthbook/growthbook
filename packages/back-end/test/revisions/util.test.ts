import type { JsonPatchOperation } from "shared/enterprise";
import { buildMergeDesiredState } from "back-end/src/revisions/util";

const updatable = new Set([
  "groupName",
  "owner",
  "values",
  "condition",
  "attributeKey",
  "description",
  "projects",
  "useEmptyListGroup",
  "archived",
]);

describe("buildMergeDesiredState", () => {
  // The C1 regression: someone flips an updatable field out-of-band while a
  // revision is in review. The revision didn't propose to change that field,
  // so the merge must NOT revert it.
  it("preserves out-of-band changes to fields the revision did not touch", () => {
    const baseSnapshot = {
      id: "sg-1",
      groupName: "v1",
      archived: false,
    };
    const liveEntity = {
      id: "sg-1",
      groupName: "v1", // unchanged
      archived: true, // flipped out-of-band after the snapshot was taken
    };
    const ops: JsonPatchOperation[] = [
      { op: "replace", path: "/groupName", value: "v2" },
    ];

    const desired = buildMergeDesiredState(
      liveEntity,
      baseSnapshot,
      ops,
      updatable,
    );

    expect(desired.groupName).toBe("v2");
    expect(desired.archived).toBe(true);
  });

  it("applies a proposed replace whose value differs from the baseline", () => {
    const baseSnapshot = { groupName: "v1", description: "d1" };
    const liveEntity = { groupName: "v1", description: "d1" };
    const ops: JsonPatchOperation[] = [
      { op: "replace", path: "/groupName", value: "v2" },
    ];

    const desired = buildMergeDesiredState(
      liveEntity,
      baseSnapshot,
      ops,
      updatable,
    );

    expect(desired.groupName).toBe("v2");
    expect(desired.description).toBe("d1");
  });

  // A no-op proposal (op.value === base[field]) shouldn't get applied to live;
  // doing so would clobber legitimate live drift on that field.
  it("drops ops whose value equals the baseline (no-op proposals)", () => {
    const baseSnapshot = { groupName: "v1", archived: false };
    const liveEntity = { groupName: "v1", archived: true };
    const ops: JsonPatchOperation[] = [
      // proposed value equals the baseline; not a real change
      { op: "replace", path: "/archived", value: false },
    ];

    const desired = buildMergeDesiredState(
      liveEntity,
      baseSnapshot,
      ops,
      updatable,
    );

    expect(desired.archived).toBe(true);
  });

  it("applies remove ops only when the baseline had a defined value", () => {
    const baseSnapshot = { groupName: "v1", description: "d1" };
    const liveEntity = { groupName: "v1", description: "d1" };
    const ops: JsonPatchOperation[] = [{ op: "remove", path: "/description" }];

    const desired = buildMergeDesiredState(
      liveEntity,
      baseSnapshot,
      ops,
      updatable,
    );

    expect(desired).not.toHaveProperty("description");
  });

  it("drops remove ops when the baseline did not define the field", () => {
    const baseSnapshot = { groupName: "v1" };
    const liveEntity = { groupName: "v1", description: "d-set-out-of-band" };
    const ops: JsonPatchOperation[] = [{ op: "remove", path: "/description" }];

    const desired = buildMergeDesiredState(
      liveEntity,
      baseSnapshot,
      ops,
      updatable,
    );

    expect(desired.description).toBe("d-set-out-of-band");
  });

  it("drops ops whose path is not in the updatable allowlist", () => {
    const baseSnapshot = { id: "sg-1", organization: "org-1", groupName: "v1" };
    const liveEntity = { id: "sg-1", organization: "org-1", groupName: "v1" };
    const ops: JsonPatchOperation[] = [
      { op: "replace", path: "/id", value: "sg-evil" },
      { op: "replace", path: "/organization", value: "org-evil" },
      { op: "replace", path: "/groupName", value: "v2" },
    ];

    const desired = buildMergeDesiredState(
      liveEntity,
      baseSnapshot,
      ops,
      updatable,
    );

    expect(desired.id).toBe("sg-1");
    expect(desired.organization).toBe("org-1");
    expect(desired.groupName).toBe("v2");
  });

  it("drops move, copy, and test ops", () => {
    const baseSnapshot = { id: "sg-1", groupName: "v1" };
    const liveEntity = { id: "sg-1", groupName: "v1" };
    const ops: JsonPatchOperation[] = [
      { op: "move", from: "/id", path: "/groupName" },
      { op: "copy", from: "/id", path: "/groupName" },
      { op: "test", path: "/groupName", value: "v1" },
    ];

    const desired = buildMergeDesiredState(
      liveEntity,
      baseSnapshot,
      ops,
      updatable,
    );

    expect(desired).toEqual(liveEntity);
  });

  it("returns the live entity unchanged when no ops are provided", () => {
    const baseSnapshot = { groupName: "v1", archived: false };
    const liveEntity = { groupName: "v1", archived: true };

    const desired = buildMergeDesiredState(
      liveEntity,
      baseSnapshot,
      [],
      updatable,
    );

    expect(desired).toEqual(liveEntity);
  });

  it("does not mutate the input live entity", () => {
    const baseSnapshot = { groupName: "v1" };
    const liveEntity = { groupName: "v1", archived: true };
    const ops: JsonPatchOperation[] = [
      { op: "replace", path: "/groupName", value: "v2" },
    ];

    buildMergeDesiredState(liveEntity, baseSnapshot, ops, updatable);

    expect(liveEntity.groupName).toBe("v1");
    expect(liveEntity.archived).toBe(true);
  });

  it("treats legacy plain-object proposedChanges as empty", () => {
    const baseSnapshot = { groupName: "v1" };
    const liveEntity = { groupName: "v1", archived: true };

    const desired = buildMergeDesiredState(
      liveEntity,
      baseSnapshot,
      { groupName: "v2" } as unknown as JsonPatchOperation[],
      updatable,
    );

    expect(desired).toEqual(liveEntity);
  });
});
