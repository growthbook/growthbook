import mongoose from "mongoose";
import type { Request } from "express";
import type { OrganizationInterface } from "shared/types/organization";
import { ReqContextClass } from "back-end/src/services/context";
import { restoreEntityPreImage } from "back-end/src/revisions/landingSequence";
import { getAdapter } from "back-end/src/revisions";
import { setupApp } from "../api/api.setup";

/**
 * Restoring a Config descendant, through the REAL adapter.
 *
 * Every compensation test mocks `applyChanges` wholesale, so the adapter's ancestor
 * normalization never ran in any of them — which is why the ordering bug below
 * survived. A restore writes through `applyChanges({isRevert: true})`, and
 * `normalizeConfigChangesAgainstAncestors` is UNCONDITIONAL there: `isRevert`
 * suppresses the veto, not the strip.
 *
 * So the order compensation restores in decides whether it works at all. Restore a
 * descendant while the root still declares the field and normalization takes it
 * straight back out — and because the key is still in `persistedKeys`, verification
 * sees nothing dropped and the restore reports SUCCESS. Root first, and the
 * descendant's restore survives.
 */

const ORG_ID = "org_cascade_restore";
const org = {
  id: ORG_ID,
  name: "Cascade Restore",
  ownerEmail: "t@t.com",
  url: "",
  dateCreated: new Date(),
  members: [],
  settings: { environments: [{ id: "production", description: "" }] },
} as unknown as OrganizationInterface;

setupApp();

function adminContext() {
  const context = new ReqContextClass({
    org,
    auditUser: { type: "api_key", apiKey: "k" },
    role: "admin",
    req: { query: {}, headers: {} } as unknown as Request,
  });
  context.hasPremiumFeature = () => true;
  return context;
}

const field = (key: string) => ({
  key,
  type: "string" as const,
  required: false,
  default: "",
  description: "",
  enum: [] as string[],
});

const schemaOf = (keys: string[]) => ({
  type: "object" as const,
  fields: keys.map(field),
});

async function seedConfig(
  key: string,
  schemaKeys: string[],
  parent?: string,
): Promise<void> {
  await mongoose.connection.collection("configs").insertOne({
    id: `cfg_${key}`,
    organization: ORG_ID,
    key,
    name: key,
    owner: "",
    type: "config",
    project: "",
    // Stored as a JSON string, not an object.
    value: "{}",
    schema: schemaOf(schemaKeys),
    ...(parent ? { parent } : {}),
    dateCreated: new Date(),
    dateUpdated: new Date(),
  });
}

async function schemaKeysOf(key: string): Promise<string[]> {
  const doc = await mongoose.connection
    .collection("configs")
    .findOne({ organization: ORG_ID, key });
  return ((doc?.schema?.fields ?? []) as { key: string }[]).map((f) => f.key);
}

describe("restoring a Config descendant after a failed cascade", () => {
  beforeEach(async () => {
    await mongoose.connection
      .collection("configs")
      .deleteMany({ organization: ORG_ID });
  });

  // The bug, stated as a test: with the root still owning `foo`, restoring the
  // descendant is a no-op that REPORTS success. This is what made the whole cascade
  // rollback mechanism ineffective while looking correct.
  it("cannot put a field back while the root still declares it", async () => {
    const context = adminContext();
    // Root owns `foo`; the child has been stripped of it by the cascade.
    await seedConfig("root", ["foo"]);
    await seedConfig("child", [], "root");

    const preImage = await mongoose.connection
      .collection("configs")
      .findOne({ organization: ORG_ID, key: "child" });

    const reported = await restoreEntityPreImage({
      context,
      entityType: "config",
      // The pre-image the cascade wrote against: the child DID declare `foo`.
      preImage: {
        ...(preImage as Record<string, unknown>),
        schema: schemaOf(["foo"]),
      } as Record<string, unknown> & { id: string },
      persistedKeys: ["schema"],
      written: { schema: schemaOf([]) },
    })
      .then(() => true)
      .catch(() => false);

    // It does not throw — the key is still in `persistedKeys`, so verification sees
    // nothing dropped. That is exactly why the ordering bug was silent.
    expect(reported).toBe(true);
    // And `foo` is still gone, because normalization stripped it right back.
    expect(await schemaKeysOf("child")).toEqual([]);
  });

  // The whole compensation, in the order it actually runs. This is the case that
  // fails under the ordering I shipped first (descendants before the root) and
  // passes under root-first — and it fails SILENTLY, reporting a clean rollback, so
  // only an assertion on the descendant's stored schema catches it.
  it("restores root and descendant together, root first", async () => {
    const context = adminContext();
    // The landing added `foo` to the root, and the cascade stripped it from the
    // child. Compensation has to undo both.
    await seedConfig("root", ["foo"]);
    await seedConfig("child", [], "root");

    const rootLive = (await mongoose.connection
      .collection("configs")
      .findOne({ organization: ORG_ID, key: "root" })) as Record<
      string,
      unknown
    > & { id: string };
    const childLive = (await mongoose.connection
      .collection("configs")
      .findOne({ organization: ORG_ID, key: "child" })) as Record<
      string,
      unknown
    > & { id: string };

    // Root first: back to a schema that does NOT declare `foo`.
    await restoreEntityPreImage({
      context,
      entityType: "config",
      preImage: { ...rootLive, schema: schemaOf([]) },
      persistedKeys: ["schema"],
      written: { schema: schemaOf(["foo"]) },
    });
    // Then the descendant, whose pre-image DID declare it.
    await restoreEntityPreImage({
      context,
      entityType: "config",
      preImage: { ...childLive, schema: schemaOf(["foo"]) },
      persistedKeys: ["schema"],
      written: { schema: schemaOf([]) },
    });

    expect(await schemaKeysOf("root")).toEqual([]);
    expect(await schemaKeysOf("child")).toEqual(["foo"]);
  });

  // The restore is reported BEFORE the repair cascade, which can throw. Reported after,
  // a repair failure left the document unrecorded even though its own restore had
  // committed — so the apply's deferred `*.updated` was emitted as durable over a
  // document holding its pre-image.
  it("reports the restored document even when the repair cascade throws", async () => {
    const context = adminContext();
    await seedConfig("root", []);
    await seedConfig("child", [], "root");
    const restored = new Set<string>();
    context.bulkPublishRestoredEntities = restored;

    const preImage = await mongoose.connection
      .collection("configs")
      .findOne({ organization: ORG_ID, key: "child" });

    const adapter = getAdapter("config") as {
      afterRestorePreImage?: unknown;
    };
    const original = adapter.afterRestorePreImage;
    adapter.afterRestorePreImage = async () => {
      throw new Error("repair cascade failed");
    };
    try {
      await expect(
        restoreEntityPreImage({
          context,
          entityType: "config",
          preImage: {
            ...(preImage as Record<string, unknown>),
            schema: schemaOf(["foo"]),
          } as Record<string, unknown> & { id: string },
          persistedKeys: ["schema"],
          written: { schema: schemaOf([]) },
        }),
      ).rejects.toThrow("repair cascade failed");
    } finally {
      adapter.afterRestorePreImage = original;
    }

    // The document itself went back, whatever the repair did.
    expect(await schemaKeysOf("child")).toEqual(["foo"]);
    expect(restored.has("config:cfg_child")).toBe(true);
  });

  // The corrected order. Once the root no longer owns `foo`, the same restore lands.
  it("puts the field back once the root no longer declares it", async () => {
    const context = adminContext();
    await seedConfig("root", []);
    await seedConfig("child", [], "root");

    const preImage = await mongoose.connection
      .collection("configs")
      .findOne({ organization: ORG_ID, key: "child" });

    await restoreEntityPreImage({
      context,
      entityType: "config",
      preImage: {
        ...(preImage as Record<string, unknown>),
        schema: schemaOf(["foo"]),
      } as Record<string, unknown> & { id: string },
      persistedKeys: ["schema"],
      written: { schema: schemaOf([]) },
    });

    expect(await schemaKeysOf("child")).toEqual(["foo"]);
  });
});
