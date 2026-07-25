import type {
  Permissions,
  RevisionAction,
  RevisionModel,
} from "shared/permissions";
import {
  canLandArchivedState,
  isArchiveTransition,
  proposedArchivedValue,
} from "back-end/src/revisions/archiveTransition";

describe("isArchiveTransition", () => {
  it("is true only when archiving a live entity", () => {
    expect(isArchiveTransition({ proposed: true, current: false })).toBe(true);
    expect(isArchiveTransition({ proposed: true, current: undefined })).toBe(
      true,
    );
  });

  it("is false when already archived — no transition to gate", () => {
    expect(isArchiveTransition({ proposed: true, current: true })).toBe(false);
  });

  it("is false for unarchiving, which stays an ordinary publish", () => {
    expect(isArchiveTransition({ proposed: false, current: true })).toBe(false);
    expect(isArchiveTransition({ proposed: false, current: false })).toBe(
      false,
    );
  });

  it("is false when the change set doesn't touch archived", () => {
    expect(isArchiveTransition({ proposed: undefined, current: false })).toBe(
      false,
    );
    expect(isArchiveTransition({ proposed: undefined, current: true })).toBe(
      false,
    );
  });
});

describe("proposedArchivedValue", () => {
  const op = (op: string, path: string, value?: unknown) => ({
    op,
    path,
    value,
  });

  it("reads an archive from a replace or add op", () => {
    expect(proposedArchivedValue([op("replace", "/archived", true)])).toBe(
      true,
    );
    expect(proposedArchivedValue([op("add", "/archived", true)])).toBe(true);
  });

  it("reads an unarchive", () => {
    expect(proposedArchivedValue([op("replace", "/archived", false)])).toBe(
      false,
    );
  });

  it("is undefined when archived isn't touched", () => {
    expect(
      proposedArchivedValue([op("replace", "/value", "x")]),
    ).toBeUndefined();
    expect(proposedArchivedValue([])).toBeUndefined();
    expect(proposedArchivedValue(undefined)).toBeUndefined();
  });

  it("ignores ops that don't set a boolean value", () => {
    expect(proposedArchivedValue([op("remove", "/archived")])).toBeUndefined();
    expect(
      proposedArchivedValue([op("replace", "/archived", "true")]),
    ).toBeUndefined();
  });

  it("does not mistake a nested path for the archived field", () => {
    expect(
      proposedArchivedValue([op("replace", "/meta/archived", true)]),
    ).toBeUndefined();
  });

  it("takes the last op, matching patch application order", () => {
    expect(
      proposedArchivedValue([
        op("replace", "/archived", true),
        op("replace", "/archived", false),
      ]),
    ).toBe(false);
    expect(
      proposedArchivedValue([
        op("replace", "/archived", false),
        op("replace", "/archived", true),
      ]),
    ).toBe(true);
  });
});

describe("canLandArchivedState", () => {
  // Records what was asked so each case can assert the atom AND the env
  // footprint — the footprint is what makes an env-limited role correct.
  function permissionsGranting(granted: {
    delete?: boolean;
    publish?: boolean;
  }) {
    const calls: Array<{ action: string; environments: string[] }> = [];
    return {
      calls,
      permissions: {
        canRevisionAction: (
          _model: RevisionModel,
          action: RevisionAction,
          _entity: { project?: string; projects?: string[] },
          environments: string[] = [],
        ) => {
          calls.push({ action, environments });
          return action === "delete" ? !!granted.delete : !!granted.publish;
        },
      } as Pick<Permissions, "canRevisionAction">,
    };
  }

  const entity = { project: "proj" };

  it("asks for the delete atom when archiving", () => {
    const { permissions, calls } = permissionsGranting({ delete: true });
    expect(
      canLandArchivedState({
        permissions,
        model: "config",
        entity,
        archived: true,
        environments: ["production"],
      }),
    ).toBe(true);
    expect(calls).toEqual([{ action: "delete", environments: [] }]);
  });

  it("asks for env-scoped publish when unarchiving", () => {
    const { permissions, calls } = permissionsGranting({ publish: true });
    expect(
      canLandArchivedState({
        permissions,
        model: "config",
        entity,
        archived: false,
        environments: ["production"],
      }),
    ).toBe(true);
    expect(calls).toEqual([
      { action: "publish", environments: ["production"] },
    ]);
  });

  it("does not let publish authority stand in for archiving", () => {
    const { permissions } = permissionsGranting({ publish: true });
    expect(
      canLandArchivedState({
        permissions,
        model: "feature",
        entity,
        archived: true,
      }),
    ).toBe(false);
  });

  it("does not let delete authority stand in for unarchiving", () => {
    const { permissions } = permissionsGranting({ delete: true });
    expect(
      canLandArchivedState({
        permissions,
        model: "feature",
        entity,
        archived: false,
      }),
    ).toBe(false);
  });
});
