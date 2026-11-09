import { InterleavingInterface } from "shared/validators";
import { Permissions } from "shared/permissions";
import type { ReqContext } from "back-end/types/request";
// Loaded first: the model registry and the model import each other, and only
// this order resolves.
import "back-end/src/services/context";
import { InterleavingModel } from "back-end/src/enterprise/models/InterleavingModel";

// Exposes the protected permission check, and skips the index setup the
// constructor would otherwise send to MongoDB.
class TestableInterleavingModel extends InterleavingModel {
  protected updateIndexes() {
    return;
  }
  publicCanUpdate(
    existing: InterleavingInterface,
    updated: Partial<InterleavingInterface>,
  ): boolean {
    return this.canUpdate(existing, updated);
  }
}

const scope = (permissions: Record<string, boolean>) => ({
  permissions,
  limitAccessByEnvironment: false,
  environments: [],
});

// May edit an interleaving experiment's analysis, but not run experiments.
const ANALYST = { readData: true, createAnalyses: true };
const RUNNER = { ...ANALYST, runExperiments: true };

function model(permissions: Record<string, boolean>) {
  return new TestableInterleavingModel({
    org: { id: "org_1" },
    environments: ["production", "dev"],
    permissions: new Permissions({ global: scope(permissions), projects: {} }),
  } as unknown as ReqContext);
}

function interleaving(
  overrides: Partial<InterleavingInterface> = {},
): InterleavingInterface {
  return {
    id: "il_1",
    organization: "org_1",
    dateCreated: new Date("2026-10-01T00:00:00Z"),
    dateUpdated: new Date("2026-10-02T00:00:00Z"),
    name: "Search ranking",
    owner: "u_1",
    tags: [],
    archived: false,
    status: "running",
    key: "search-ranking",
    trackingKey: "search-ranking",
    hashAttribute: "id",
    seed: "seed",
    variations: {
      control: { id: "v0", key: "popular", name: "Popular", config: "{}" },
      treatment: {
        id: "v1",
        key: "buyers-pick",
        name: "Buyer's pick",
        config: "{}",
      },
    },
    jsonSchema: null,
    datasourceId: "ds_1",
    interleavingExposureQueryId: "ilq_1",
    userIdType: "user_id",
    metrics: [],
    environmentSettings: { production: { enabled: true } },
    ...overrides,
  };
}

describe("InterleavingModel update permission for the tracking key", () => {
  const serving = interleaving();

  it("refuses a new tracking key on a serving experiment without run permission", () => {
    expect(
      model(ANALYST).publicCanUpdate(serving, { trackingKey: "search-v2" }),
    ).toBe(false);
  });

  it("allows a new tracking key on a serving experiment with run permission", () => {
    expect(
      model(RUNNER).publicCanUpdate(serving, { trackingKey: "search-v2" }),
    ).toBe(true);
  });

  // Clients may send the key with every save; only a different value counts.
  it("allows the unchanged tracking key to be sent without run permission", () => {
    expect(
      model(ANALYST).publicCanUpdate(serving, {
        trackingKey: serving.trackingKey,
        userIdType: "device_id",
      }),
    ).toBe(true);
  });

  it("allows a new tracking key on a draft without run permission", () => {
    expect(
      model(ANALYST).publicCanUpdate(interleaving({ status: "draft" }), {
        trackingKey: "search-v2",
      }),
    ).toBe(true);
  });
});
