import {
  canCommentOnRevisionEntity,
  canDeleteArchivedEntity,
  canLandArchiveToggle,
  canEnableEnvironmentOnCreate,
  canLandRevertToTarget,
  holdsFeatureMoveDestination,
  holdsRevisionDestination,
} from "@/components/Revision/revisionAuthority";

/**
 * Mirrors the server's `canCommentOnRevision`. Two things make this worth
 * pinning: commenting is participation, so draft or review authority allows it
 * as well as the addComments atom; and it is decided on the REVISION's snapshot,
 * not the live entity, because a comment belongs to the revision and the
 * revision's project may predate a move.
 */

type Util = Parameters<typeof canCommentOnRevisionEntity>[0];

function util({
  addComment = [],
  draft = [],
  review = [],
}: {
  addComment?: string[];
  draft?: string[];
  review?: string[];
}): Util {
  const asked = (obj: { project?: string; projects?: string[] }) =>
    obj.projects ?? (obj.project ? [obj.project] : []);
  const holds =
    (allowed: string[]) => (obj: { project?: string; projects?: string[] }) =>
      asked(obj).some((p) => allowed.includes(p)) ||
      (asked(obj).length === 0 && allowed.includes(""));
  return {
    canAddComment: (projects: string[]) => holds(addComment)({ projects }),
    canRevisionAction: (
      _type: string,
      action: string,
      obj: { project?: string; projects?: string[] },
    ) =>
      action === "draft"
        ? holds(draft)(obj)
        : action === "review"
          ? holds(review)(obj)
          : false,
  } as unknown as Util;
}

const liveInB = { project: "b" };
const revisionFromA = { target: { snapshot: { project: "a" } } };

describe("canCommentOnRevisionEntity", () => {
  it("accepts the addComments atom on its own", () => {
    expect(
      canCommentOnRevisionEntity(
        util({ addComment: ["a"] }),
        "config",
        revisionFromA,
        liveInB,
      ),
    ).toBe(true);
  });

  it("accepts draft authority, which the server also accepts", () => {
    expect(
      canCommentOnRevisionEntity(
        util({ draft: ["a"] }),
        "config",
        revisionFromA,
        liveInB,
      ),
    ).toBe(true);
  });

  it("accepts review authority, so reviewers are not shut out of the thread", () => {
    expect(
      canCommentOnRevisionEntity(
        util({ review: ["a"] }),
        "config",
        revisionFromA,
        liveInB,
      ),
    ).toBe(true);
  });

  it("refuses someone with none of the three", () => {
    expect(
      canCommentOnRevisionEntity(
        util({ addComment: ["z"], draft: ["z"], review: ["z"] }),
        "config",
        revisionFromA,
        liveInB,
      ),
    ).toBe(false);
  });

  it("decides on the revision's snapshot, not the live entity", () => {
    // The entity has moved A→B. Authority in A — where the revision was authored
    // — is what counts, and authority in B alone is not enough.
    expect(
      canCommentOnRevisionEntity(
        util({ addComment: ["a"] }),
        "config",
        revisionFromA,
        liveInB,
      ),
    ).toBe(true);
    expect(
      canCommentOnRevisionEntity(
        util({ addComment: ["b"] }),
        "config",
        revisionFromA,
        liveInB,
      ),
    ).toBe(false);
  });

  it("falls back to the live entity when no revision is selected", () => {
    expect(
      canCommentOnRevisionEntity(
        util({ addComment: ["b"] }),
        "config",
        null,
        liveInB,
      ),
    ).toBe(true);
  });

  it("reads the whole project list for a multi-project entity", () => {
    const sgRevision = { target: { snapshot: { projects: ["p1", "p2"] } } };
    expect(
      canCommentOnRevisionEntity(
        util({ addComment: ["p2"] }),
        "saved-group",
        sgRevision,
        { projects: ["p9"] },
      ),
    ).toBe(true);
  });
});

describe("archive and delete authority", () => {
  const held = (allowed: { publish?: string[]; delete?: string[] }) =>
    ({
      canRevisionAction: (
        _m: string,
        action: string,
        obj: { project?: string },
        envs: string[] = [],
      ) => {
        const list =
          action === "publish"
            ? allowed.publish
            : action === "delete"
              ? allowed.delete
              : [];
        if (!(list ?? []).includes(obj.project ?? "")) return false;
        // A footprint of production is only held by someone granted it.
        return (
          !envs.includes("production") || (list ?? []).includes("production")
        );
      },
    }) as unknown as Parameters<typeof canLandArchiveToggle>[0];

  it("archiving is delete-class over the environments the entity serves", () => {
    expect(
      canLandArchiveToggle(
        held({ delete: ["a"] }),
        "config",
        { project: "a" },
        [],
      ),
    ).toBe(true);
    expect(
      canLandArchiveToggle(
        held({ publish: ["a"] }),
        "config",
        { project: "a" },
        [],
      ),
    ).toBe(false);
  });

  it("unarchiving is an ordinary publish", () => {
    const archived = { project: "a", archived: true };
    expect(
      canLandArchiveToggle(held({ publish: ["a"] }), "config", archived, []),
    ).toBe(true);
    expect(
      canLandArchiveToggle(held({ delete: ["a"] }), "config", archived, []),
    ).toBe(false);
  });

  it("deleting needs the entity archived, and then carries no footprint", () => {
    expect(
      canDeleteArchivedEntity(held({ delete: ["a"] }), "config", {
        project: "a",
      }),
    ).toBe(false);
    expect(
      canDeleteArchivedEntity(held({ delete: ["a"] }), "config", {
        project: "a",
        archived: true,
      }),
    ).toBe(true);
  });
});

/**
 * The destination side of a relocation. Both helpers exist because the source
 * project answers the wrong question when a change moves the entity: landing it
 * writes to the destination, and the narrow-atom exemptions (a pure revert, a
 * pure archive) do not extend across a move.
 */

type ActionUtil = Parameters<typeof holdsRevisionDestination>[0];

// Grants `action` only in the listed projects, over any environment.
function actionUtil(
  action: string,
  projects: string[],
  environments?: string[],
): ActionUtil {
  return {
    canRevisionAction: (
      _model: string,
      asked: string,
      obj: { project?: string; projects?: string[] },
      envs?: string[],
    ) => {
      if (asked !== action) return false;
      const scope = obj.projects ?? (obj.project ? [obj.project] : []);
      const inProject = scope.length
        ? scope.some((p) => projects.includes(p))
        : projects.includes("");
      if (!inProject) return false;
      if (!environments || !envs?.length) return true;
      return envs.every((e) => environments.includes(e));
    },
  } as unknown as ActionUtil;
}

const movesToC = {
  target: {
    proposedChanges: [{ op: "replace", path: "/project", value: "c" }],
  },
};

describe("holdsRevisionDestination", () => {
  it("passes vacuously when the revision moves nothing", () => {
    expect(
      holdsRevisionDestination(
        actionUtil("revert", []),
        "constant",
        "revert",
        { target: { proposedChanges: [{ op: "replace", path: "/value" }] } },
        { project: "b" },
        [],
      ),
    ).toBe(true);
  });

  it("refuses a move into a project the viewer lacks the verb in", () => {
    expect(
      holdsRevisionDestination(
        actionUtil("revert", ["b"]),
        "constant",
        "revert",
        movesToC,
        { project: "b" },
        [],
      ),
    ).toBe(false);
  });

  it("accepts a move into a project the viewer holds the verb in", () => {
    expect(
      holdsRevisionDestination(
        actionUtil("revert", ["b", "c"]),
        "constant",
        "revert",
        movesToC,
        { project: "b" },
        [],
      ),
    ).toBe(true);
  });

  it("asks about the verb it was given, not publish", () => {
    // A deleter landing a pure archive that also relocates needs delete THERE.
    expect(
      holdsRevisionDestination(
        actionUtil("publish", ["c"]),
        "constant",
        "delete",
        movesToC,
        { project: "b" },
        [],
      ),
    ).toBe(false);
  });
});

describe("canLandRevertToTarget", () => {
  it("requires the revert atom over the restore's own footprint", () => {
    const util = actionUtil("revert", ["b"], ["dev"]);
    expect(
      canLandRevertToTarget(util, "constant", { project: "b" }, {}, ["dev"]),
    ).toBe(true);
    // The same viewer, restoring a snapshot that touches production.
    expect(
      canLandRevertToTarget(util, "constant", { project: "b" }, {}, ["prod"]),
    ).toBe(false);
  });

  it("refuses a restore that moves the entity somewhere the viewer cannot revert", () => {
    expect(
      canLandRevertToTarget(
        actionUtil("revert", ["b"]),
        "constant",
        { project: "b" },
        { project: "c" },
        [],
      ),
    ).toBe(false);
  });
});

describe("holdsFeatureMoveDestination", () => {
  const util = {
    canPublishFeature: (f: { project?: string }, envs: string[]) =>
      f.project === "c" && envs.every((e) => e === "dev"),
  } as unknown as Parameters<typeof holdsFeatureMoveDestination>[0];

  it("passes when the revision names no project", () => {
    expect(
      holdsFeatureMoveDestination(util, { project: "b" }, undefined, ["prod"]),
    ).toBe(true);
  });

  it("passes when the named project is the one it already lives in", () => {
    expect(
      holdsFeatureMoveDestination(util, { project: "b" }, "b", ["prod"]),
    ).toBe(true);
  });

  it("requires publish authority in the destination, over the same footprint", () => {
    expect(
      holdsFeatureMoveDestination(util, { project: "b" }, "c", ["dev"]),
    ).toBe(true);
    expect(
      holdsFeatureMoveDestination(util, { project: "b" }, "c", ["prod"]),
    ).toBe(false);
    expect(
      holdsFeatureMoveDestination(util, { project: "b" }, "d", ["dev"]),
    ).toBe(false);
  });

  it("treats a move to no project as a move", () => {
    expect(
      holdsFeatureMoveDestination(util, { project: "b" }, "", ["dev"]),
    ).toBe(false);
  });
});

describe("canEnableEnvironmentOnCreate", () => {
  const util = (create: string[], publish: string[]) =>
    ({
      canCreateFeature: (f: { project?: string }, envs: string[]) =>
        f.project === "p" && envs.every((e) => create.includes(e)),
      canPublishFeature: (f: { project?: string }, envs: string[]) =>
        f.project === "p" && envs.every((e) => publish.includes(e)),
    }) as unknown as Parameters<typeof canEnableEnvironmentOnCreate>[0];

  it("requires both atoms in that environment", () => {
    expect(
      canEnableEnvironmentOnCreate(util(["dev"], ["dev"]), "p", "dev"),
    ).toBe(true);
  });

  it("refuses a create-only role — the endpoint would too", () => {
    expect(canEnableEnvironmentOnCreate(util(["dev"], []), "p", "dev")).toBe(
      false,
    );
  });

  it("refuses when create is missing in that environment", () => {
    expect(canEnableEnvironmentOnCreate(util([], ["dev"]), "p", "dev")).toBe(
      false,
    );
  });

  it("is per environment, not per project", () => {
    const u = util(["dev", "prod"], ["dev"]);
    expect(canEnableEnvironmentOnCreate(u, "p", "dev")).toBe(true);
    expect(canEnableEnvironmentOnCreate(u, "p", "prod")).toBe(false);
  });
});
