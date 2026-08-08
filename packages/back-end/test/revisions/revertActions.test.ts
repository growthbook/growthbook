import { PermissionError } from "shared/util";
import {
  assertCanRevertRevision,
  resolveRevertStrategy,
  revertTargetState,
} from "back-end/src/revisions/revertActions";
import { Context } from "back-end/src/models/BaseModel";

/**
 * Revert authority is the piece that kept going wrong, in both directions: derived
 * from the landing footprint it locked environment-limited reverters out of even
 * proposing; derived from the project it let them land. These pin the distinction,
 * plus the two classes a revert can span beyond the revert atom itself.
 */

type Held = {
  revert?: string[];
  publish?: string[];
  draft?: string[];
  delete?: string[];
};

function contextHolding(held: Held, envs?: Record<string, string[]>): Context {
  const permissions = {
    canRevisionAction: (
      _model: string,
      action: keyof Held,
      obj: { project?: string; projects?: string[] },
      environments: string[] = [],
    ) => {
      const asked = obj.projects ?? (obj.project ? [obj.project] : [""]);
      const projects = asked.length ? asked : [""];
      const allowed = held[action] ?? [];
      if (!projects.every((p) => allowed.includes(p))) return false;
      // An empty request means "no environment dimension" and always passes.
      const grantedEnvs = envs?.[action];
      if (!grantedEnvs || !environments.length) return true;
      return environments.every((e) => grantedEnvs.includes(e));
    },
    throwPermissionError: () => {
      throw new PermissionError("denied");
    },
  };
  return { permissions } as unknown as Context;
}

const inA = { id: "e1", project: "a" };

describe("revertTargetState", () => {
  it("is the target revision's snapshot with its own changes applied", () => {
    expect(
      revertTargetState({
        target: {
          type: "constant",
          id: "c1",
          snapshot: { value: "old", other: 1 },
          proposedChanges: [{ op: "replace", path: "/value", value: "new" }],
        },
      } as never),
    ).toEqual({ value: "new", other: 1 });
  });
});

describe("resolveRevertStrategy", () => {
  it("defaults to a draft, and to publishing when reverts bypass approval", () => {
    expect(resolveRevertStrategy(undefined, false)).toBe("draft");
    expect(resolveRevertStrategy(undefined, true)).toBe("publish");
  });

  it("honours an explicit request over the org default", () => {
    expect(resolveRevertStrategy("draft", true)).toBe("draft");
    expect(resolveRevertStrategy("publish", false)).toBe("publish");
  });
});

describe("assertCanRevertRevision", () => {
  const revert = (
    over: Partial<Parameters<typeof assertCanRevertRevision>[0]>,
  ) =>
    assertCanRevertRevision({
      context: contextHolding({ revert: ["a"] }),
      entityType: "constant",
      entity: inA,
      fields: { value: "restored" },
      landing: false,
      footprint: [],
      ...over,
    });

  it("lets an environment-limited reverter PROPOSE, which publishes nothing", () => {
    expect(() =>
      revert({
        context: contextHolding({ revert: ["a"] }, { revert: ["dev"] }),
        landing: false,
        footprint: ["production"],
      }),
    ).not.toThrow();
  });

  it("refuses that same reverter LANDING into an environment they lack", () => {
    expect(() =>
      revert({
        context: contextHolding({ revert: ["a"] }, { revert: ["dev"] }),
        landing: true,
        footprint: ["production"],
      }),
    ).toThrow(PermissionError);
  });

  it("lets them land inside their own environments", () => {
    expect(() =>
      revert({
        context: contextHolding({ revert: ["a"] }, { revert: ["dev"] }),
        landing: true,
        footprint: ["dev"],
      }),
    ).not.toThrow();
  });

  it("does not accept publish authority in place of the revert atom", () => {
    // Publish subsumes revert when publishing a revision that IS a pure revert —
    // that belongs to the publish engine. The revert action is its own authority,
    // so a publisher cannot rewrite history and a revert-only responder can.
    expect(() =>
      revert({ context: contextHolding({ publish: ["a"] }), landing: true }),
    ).toThrow(PermissionError);
  });

  it("lets a draft author propose but not land", () => {
    expect(() =>
      revert({ context: contextHolding({ draft: ["a"] }), landing: false }),
    ).not.toThrow();
    expect(() =>
      revert({ context: contextHolding({ draft: ["a"] }), landing: true }),
    ).toThrow(PermissionError);
  });

  it("requires authority in the DESTINATION when the revert relocates the entity", () => {
    // Holds revert in the source only; the restored state moves it to b.
    expect(() => revert({ fields: { project: "b" }, landing: true })).toThrow(
      PermissionError,
    );
    expect(() =>
      revert({
        context: contextHolding({ revert: ["a", "b"] }),
        fields: { project: "b" },
        landing: true,
      }),
    ).not.toThrow();
  });

  it("checks the destination when merely STAGING a relocation too", () => {
    expect(() =>
      revert({
        context: contextHolding({ draft: ["a"] }),
        fields: { project: "b" },
        landing: false,
      }),
    ).toThrow(PermissionError);
  });

  it("treats restoring an archived state as delete-class once it lands", () => {
    expect(() => revert({ fields: { archived: true }, landing: true })).toThrow(
      PermissionError,
    );
    expect(() =>
      revert({
        context: contextHolding({ revert: ["a"], delete: ["a"] }),
        fields: { archived: true },
        landing: true,
      }),
    ).not.toThrow();
  });

  it("does not ask for the delete atom to merely stage an archive restore", () => {
    expect(() =>
      revert({ fields: { archived: true }, landing: false }),
    ).not.toThrow();
  });
});
