import mongoose from "mongoose";
import type { Response } from "express";
import type { OrganizationInterface } from "shared/types/organization";
import {
  getFeaturesDependents,
  getFeaturesStaleStates,
} from "back-end/src/controllers/features";
import { getFeature, updateFeature } from "back-end/src/models/FeatureModel";
import { ReqContextClass } from "back-end/src/services/context";
import { invalidateFeatureGraph } from "back-end/src/services/featureGraphCache";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { setupApp } from "../api.setup";

// End-to-end drive of the cached graph endpoints: real controllers, real
// models, real Mongo — no mocks. Verifies the full chain (load → migrate →
// permission filter → lookups → response), that reads inside the TTL window
// are served from the snapshot, and that the model write hooks invalidate it.

const ORG_ID = "org_stale_graph_integration";

const org = {
  id: ORG_ID,
  name: "Stale Graph Integration",
  ownerEmail: "test@test.com",
  url: "",
  dateCreated: new Date(),
  members: [],
  settings: {
    environments: [{ id: "production", description: "" }],
  },
} as unknown as OrganizationInterface;

function makeReq(query: Record<string, string>) {
  return {
    organization: org,
    userId: "u_test",
    email: "test@test.com",
    name: "Test",
    superAdmin: true,
    teams: [],
    query,
    headers: {},
  } as unknown as AuthRequest<null, Record<string, never>, { ids?: string }>;
}

function makeRes<T>() {
  const captured: { body?: T } = {};
  const res = {
    status() {
      return res;
    },
    json(v: T) {
      captured.body = v;
      return res;
    },
  };
  return { res: res as unknown as Response, captured };
}

function featureDoc(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    organization: ORG_ID,
    version: 1,
    defaultValue: "false",
    valueType: "boolean",
    owner: "",
    description: "",
    project: "",
    tags: [],
    dateCreated: new Date(),
    dateUpdated: new Date(),
    rules: [],
    environmentSettings: { production: { enabled: true, rules: [] } },
    archived: false,
    ...extra,
  };
}

describe("stale-graph endpoints over the org feature-graph cache", () => {
  setupApp();

  beforeEach(() => {
    invalidateFeatureGraph();
  });

  it("serves dependents/stale from one snapshot and refreshes on real writes", async () => {
    const features = mongoose.connection.collection("features");
    await features.insertOne(featureDoc("feat_parent"));
    await features.insertOne(
      featureDoc("feat_child", {
        prerequisites: [{ id: "feat_parent", condition: '{"value": true}' }],
      }),
    );

    // 1. Real dependents read: child depends on parent through the graph.
    let dependents = makeRes<{
      dependents: Record<string, { features: string[] }>;
    }>();
    await getFeaturesDependents(
      makeReq({ ids: "feat_parent" }),
      dependents.res,
    );
    expect(
      dependents.captured.body?.dependents["feat_parent"].features,
    ).toEqual(["feat_child"]);

    // 2. Real stale read for a single id returns a computed entry stamped
    // with the snapshot's load time.
    const stale = makeRes<{
      features: Record<string, { stale: boolean; computedAt: string }>;
    }>();
    await getFeaturesStaleStates(makeReq({ ids: "feat_child" }), stale.res);
    const entry = stale.captured.body?.features["feat_child"];
    expect(entry).toBeDefined();
    expect(typeof entry?.stale).toBe("boolean");
    expect(new Date(entry?.computedAt ?? 0).getTime()).toBeGreaterThan(0);

    // 3. Cached read: delete the child BEHIND the cache (raw collection
    // write, no model hook) — within the TTL the snapshot still serves it.
    await features.deleteOne({ id: "feat_child" });
    dependents = makeRes();
    await getFeaturesDependents(
      makeReq({ ids: "feat_parent" }),
      dependents.res,
    );
    expect(
      dependents.captured.body?.dependents["feat_parent"].features,
    ).toEqual(["feat_child"]);

    // 4. A real model write fires the hook that invalidates the snapshot, so
    // the next read reflects the raw delete too.
    const context = new ReqContextClass({
      org,
      auditUser: {
        type: "dashboard",
        id: "u_test",
        email: "test@test.com",
        name: "Test",
      },
      role: "admin",
    });
    const parent = await getFeature(context, "feat_parent");
    if (!parent) throw new Error("parent feature missing");
    await updateFeature(context, parent, { description: "touched" });

    dependents = makeRes();
    await getFeaturesDependents(
      makeReq({ ids: "feat_parent" }),
      dependents.res,
    );
    expect(
      dependents.captured.body?.dependents["feat_parent"].features,
    ).toEqual([]);
  });
});
