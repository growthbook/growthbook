import { Collection } from "mongodb";
import {
  ContextualBanditEventInterface,
  ContextualBanditInterface,
  ContextualBanditSnapshotInterface,
} from "shared/validators";
import { ExperimentInterface } from "shared/types/experiment";
import { Context } from "back-end/src/models/BaseModel";
import { ContextualBanditModel } from "back-end/src/enterprise/models/ContextualBanditModel";
import { ContextualBanditEventModel } from "back-end/src/enterprise/models/ContextualBanditEventModel";
import { ContextualBanditSnapshotModel } from "back-end/src/enterprise/models/ContextualBanditSnapshotModel";

// Skip mongoose-connection-touching index creation; we only exercise the
// protected permission methods here.
const collectionStub: Partial<Collection> = {};

class TestCBModel extends ContextualBanditModel {
  protected _dangerousGetCollection(): Collection {
    return collectionStub as Collection;
  }
  protected updateIndexes() {}

  public exposedCanRead(doc: ContextualBanditInterface): boolean {
    return this["canRead"](doc);
  }
  public exposedCanCreate(doc: ContextualBanditInterface): boolean {
    return this["canCreate"](doc);
  }
  public exposedCanUpdate(doc: ContextualBanditInterface): boolean {
    return this["canUpdate"](doc, {}, doc);
  }
  public exposedCanDelete(doc: ContextualBanditInterface): boolean {
    return this["canDelete"](doc);
  }
}

class TestCBEventModel extends ContextualBanditEventModel {
  protected _dangerousGetCollection(): Collection {
    return collectionStub as Collection;
  }
  protected updateIndexes() {}

  public exposedCanRead(doc: ContextualBanditEventInterface): boolean {
    return this["canRead"](doc);
  }
  public exposedCanCreate(doc: ContextualBanditEventInterface): boolean {
    return this["canCreate"](doc);
  }
  public exposedCanUpdate(doc: ContextualBanditEventInterface): boolean {
    return this["canUpdate"](doc, {}, doc);
  }
  public exposedCanDelete(doc: ContextualBanditEventInterface): boolean {
    return this["canDelete"](doc);
  }
}

class TestCBSnapshotModel extends ContextualBanditSnapshotModel {
  protected _dangerousGetCollection(): Collection {
    return collectionStub as Collection;
  }
  protected updateIndexes() {}

  public exposedCanRead(doc: ContextualBanditSnapshotInterface): boolean {
    return this["canRead"](doc);
  }
  public exposedCanCreate(doc: ContextualBanditSnapshotInterface): boolean {
    return this["canCreate"](doc);
  }
  public exposedCanUpdate(doc: ContextualBanditSnapshotInterface): boolean {
    return this["canUpdate"](doc, {}, doc);
  }
  public exposedCanDelete(doc: ContextualBanditSnapshotInterface): boolean {
    return this["canDelete"](doc);
  }
}

function makeExperiment(
  overrides: Partial<ExperimentInterface> = {},
): ExperimentInterface {
  return {
    id: "exp_1",
    organization: "org_1",
    project: "proj_1",
    type: "contextual-bandit",
    phases: [],
    variations: [],
    hasVisualChangesets: false,
    linkedFeatures: [],
    ...overrides,
  } as unknown as ExperimentInterface;
}

function makeContext({
  experiment,
  canReadProject,
  canRun,
  canDelete,
}: {
  experiment: ExperimentInterface | null;
  canReadProject?: boolean;
  canRun?: boolean;
  canDelete?: boolean;
}): Context {
  const refsMap = new Map<string, ExperimentInterface>();
  if (experiment) refsMap.set(experiment.id, experiment);
  return {
    org: { id: "org_1", settings: { environments: [{ id: "production" }] } },
    foreignRefs: { experiment: refsMap },
    permissions: {
      canReadSingleProjectResource: jest.fn(() => canReadProject ?? false),
      canRunExperiment: jest.fn(() => canRun ?? false),
      canDeleteExperiment: jest.fn(() => canDelete ?? false),
      throwPermissionError: jest.fn(() => {
        throw new Error("PermissionError");
      }),
    },
    // populateForeignRefs is invoked by base read paths; not used here since
    // we call permission methods directly with an already-populated refs map.
  } as unknown as Context;
}

function makeCb(): ContextualBanditInterface {
  return {
    id: "cb_1",
    organization: "org_1",
    dateCreated: new Date(),
    dateUpdated: new Date(),
    experiment: "exp_1",
  } as unknown as ContextualBanditInterface;
}

function makeCbe(): ContextualBanditEventInterface {
  return {
    id: "cbe_1",
    organization: "org_1",
    dateCreated: new Date(),
    dateUpdated: new Date(),
    experiment: "exp_1",
    phase: 0,
  } as unknown as ContextualBanditEventInterface;
}

function makeCbs(): ContextualBanditSnapshotInterface {
  return {
    id: "cbs_1",
    organization: "org_1",
    dateCreated: new Date(),
    dateUpdated: new Date(),
    experiment: "exp_1",
    phase: 0,
  } as unknown as ContextualBanditSnapshotInterface;
}

describe("ContextualBandit model RBAC", () => {
  describe.each([
    {
      name: "ContextualBanditModel",
      build: (ctx: Context) => new TestCBModel(ctx),
      makeDoc: () =>
        makeCb() as
          | ContextualBanditInterface
          | ContextualBanditEventInterface
          | ContextualBanditSnapshotInterface,
    },
    {
      name: "ContextualBanditEventModel",
      build: (ctx: Context) => new TestCBEventModel(ctx),
      makeDoc: () => makeCbe(),
    },
    {
      name: "ContextualBanditSnapshotModel",
      build: (ctx: Context) => new TestCBSnapshotModel(ctx),
      makeDoc: () => makeCbs(),
    },
  ])("$name", ({ build, makeDoc }) => {
    it("denies all actions when the parent experiment is missing from foreignRefs", () => {
      const ctx = makeContext({
        experiment: null,
        canReadProject: true,
        canRun: true,
        canDelete: true,
      });
      const model = build(ctx) as TestCBModel &
        TestCBEventModel &
        TestCBSnapshotModel;
      const doc = makeDoc();

      expect(model.exposedCanRead(doc)).toBe(false);
      expect(model.exposedCanCreate(doc)).toBe(false);
      expect(model.exposedCanUpdate(doc)).toBe(false);
      expect(model.exposedCanDelete(doc)).toBe(false);

      // None of the underlying permission calls should fire when we abort on
      // missing parent — proves we never default-allow.
      expect(
        (ctx.permissions.canReadSingleProjectResource as jest.Mock).mock.calls,
      ).toHaveLength(0);
      expect(
        (ctx.permissions.canRunExperiment as jest.Mock).mock.calls,
      ).toHaveLength(0);
      expect(
        (ctx.permissions.canDeleteExperiment as jest.Mock).mock.calls,
      ).toHaveLength(0);
    });

    it("denies read when the user lacks readData on the parent's project (cross-project / no-access)", () => {
      const ctx = makeContext({
        experiment: makeExperiment({ project: "proj_other" }),
        canReadProject: false,
      });
      const model = build(ctx) as TestCBModel &
        TestCBEventModel &
        TestCBSnapshotModel;
      expect(model.exposedCanRead(makeDoc())).toBe(false);
      expect(ctx.permissions.canReadSingleProjectResource).toHaveBeenCalledWith(
        "proj_other",
      );
    });

    it("allows read when readData is granted on the parent's project", () => {
      const ctx = makeContext({
        experiment: makeExperiment({ project: "proj_1" }),
        canReadProject: true,
      });
      const model = build(ctx) as TestCBModel &
        TestCBEventModel &
        TestCBSnapshotModel;
      expect(model.exposedCanRead(makeDoc())).toBe(true);
    });

    it("requires canRunExperiment for create/update", () => {
      const exp = makeExperiment({ project: "proj_1" });
      const denyRun = makeContext({ experiment: exp, canRun: false });
      const allowRun = makeContext({ experiment: exp, canRun: true });

      const denied = build(denyRun) as TestCBModel &
        TestCBEventModel &
        TestCBSnapshotModel;
      expect(denied.exposedCanCreate(makeDoc())).toBe(false);
      expect(denied.exposedCanUpdate(makeDoc())).toBe(false);

      const allowed = build(allowRun) as TestCBModel &
        TestCBEventModel &
        TestCBSnapshotModel;
      expect(allowed.exposedCanCreate(makeDoc())).toBe(true);
      expect(allowed.exposedCanUpdate(makeDoc())).toBe(true);
    });

    it("requires canDeleteExperiment for delete", () => {
      const exp = makeExperiment({ project: "proj_1" });
      const denyDelete = makeContext({ experiment: exp, canDelete: false });
      const allowDelete = makeContext({ experiment: exp, canDelete: true });

      expect(
        (build(denyDelete) as TestCBModel).exposedCanDelete(
          makeDoc() as ContextualBanditInterface,
        ),
      ).toBe(false);
      expect(
        (build(allowDelete) as TestCBModel).exposedCanDelete(
          makeDoc() as ContextualBanditInterface,
        ),
      ).toBe(true);
    });
  });
});
