import "back-end/src/services/context";
import fs from "fs";
import path from "path";
import mongoose from "mongoose";
import type { z } from "zod";
import { experimentInterface, featureInterface } from "shared/validators";
import {
  FEATURE_ID_REFERENCES,
  IGNORED_FEATURE_ID_PATHS,
  renamePrerequisites,
} from "back-end/src/services/featureRename/featureIdReferences";
import {
  FEATURE_ID_KEY,
  featureIdShapedPaths,
} from "back-end/src/services/featureRename/schemaScan";

type ModelConfigSource = {
  getModelConfig: () => { schema?: z.ZodType; collectionName: string };
};

async function baseModelPaths(found: Map<string, Set<string>>) {
  for (const dir of ["../../src/models", "../../src/enterprise/models"]) {
    const abs = path.join(__dirname, dir);
    for (const file of fs.readdirSync(abs)) {
      if (!file.endsWith(".ts")) continue;
      const mod: Record<string, unknown> = await import(path.join(abs, file));
      for (const value of Object.values(mod)) {
        const source = value as Partial<ModelConfigSource> | null;
        if (typeof source?.getModelConfig !== "function") continue;
        let config: ReturnType<ModelConfigSource["getModelConfig"]>;
        try {
          config = source.getModelConfig();
        } catch {
          // The abstract base class.
          continue;
        }
        if (config.schema) {
          add(
            found,
            config.collectionName,
            featureIdShapedPaths(config.schema),
          );
        }
      }
    }
  }
}

function mongoosePaths(found: Map<string, Set<string>>) {
  for (const name of mongoose.modelNames()) {
    const model = mongoose.model(name);
    const paths: string[] = [];
    model.schema.eachPath((p, type) => {
      paths.push(p);
      (type as { schema?: mongoose.Schema }).schema?.eachPath((q) =>
        paths.push(`${p}.[].${q}`),
      );
    });
    add(
      found,
      model.collection.collectionName,
      paths.filter((p) => FEATURE_ID_KEY.test(p.split(".").pop() ?? "")),
    );
  }
}

function add(
  found: Map<string, Set<string>>,
  collection: string,
  paths: string[],
) {
  if (!paths.length) return;
  const set = found.get(collection) ?? new Set<string>();
  paths.forEach((p) => set.add(p));
  found.set(collection, set);
}

describe("feature id references", () => {
  it("covers every feature-id-shaped path in every stored schema", async () => {
    const found = new Map<string, Set<string>>();
    await baseModelPaths(found);
    mongoosePaths(found);
    // Legacy models whose mongoose schemas hide nested shapes behind `{}`.
    const featurePaths = featureIdShapedPaths(featureInterface);
    add(found, "features", featurePaths);
    add(
      found,
      "featurerevisions",
      featurePaths
        .filter((p) => p.startsWith("legacyDraft."))
        .map((p) => p.slice("legacyDraft.".length)),
    );
    add(found, "experiments", featureIdShapedPaths(experimentInterface));

    const uncovered: string[] = [];
    for (const [collection, paths] of found) {
      const reference = FEATURE_ID_REFERENCES.find(
        (r) => r.collection === collection,
      );
      const ignored = IGNORED_FEATURE_ID_PATHS[collection] ?? {};
      for (const p of paths) {
        if (reference?.covers.includes(p) || p in ignored) continue;
        uncovered.push(`${collection}: ${p}`);
      }
    }
    // A new path here needs an entry in FEATURE_ID_REFERENCES, or an
    // IGNORED_FEATURE_ID_PATHS reason for why a rename may leave it behind.
    expect(uncovered).toEqual([]);

    const staleIgnores = Object.entries(IGNORED_FEATURE_ID_PATHS).flatMap(
      ([collection, paths]) =>
        Object.keys(paths)
          .filter((p) => !found.get(collection)?.has(p))
          .map((p) => `${collection}: ${p}`),
    );
    expect(staleIgnores).toEqual([]);

    // A cover no schema has is a typo or a field that moved. Only a flag's
    // own `id` is written outside the scan.
    const staleCovers = FEATURE_ID_REFERENCES.flatMap((reference) =>
      reference.covers
        .filter((p) => p !== "id" && !found.get(reference.collection)?.has(p))
        .map((p) => `${reference.collection}: ${p}`),
    );
    expect(staleCovers).toEqual([]);
  });

  it("renames prerequisites at any depth and leaves other ids alone", () => {
    const doc = {
      id: "old",
      rules: {
        production: [
          { id: "r1", prerequisites: [{ id: "old", condition: "{}" }] },
          { id: "r2", prerequisites: [{ id: "other", condition: "{}" }] },
        ],
      },
      steps: [{ actions: [{ patch: { prerequisites: [{ id: "old" }] } }] }],
      dateUpdated: new Date(0),
    };
    const { value, changed } = renamePrerequisites(doc, "old", "new");
    expect(changed).toBe(true);
    expect(value).toEqual({
      id: "old",
      rules: {
        production: [
          { id: "r1", prerequisites: [{ id: "new", condition: "{}" }] },
          { id: "r2", prerequisites: [{ id: "other", condition: "{}" }] },
        ],
      },
      steps: [{ actions: [{ patch: { prerequisites: [{ id: "new" }] } }] }],
      dateUpdated: new Date(0),
    });
    expect(renamePrerequisites(value, "old", "new").changed).toBe(false);
  });

  it("rewrites each collection's references", () => {
    const ref = { from: "old", to: "new", environments: ["production"] };
    const rewrite = (collection: string, doc: Record<string, unknown>) =>
      FEATURE_ID_REFERENCES.find((r) => r.collection === collection)?.rewrite(
        doc,
        ref,
      );

    expect(
      rewrite("featurerevisions", {
        id: "frev_3_old",
        featureId: "old",
        version: 3,
        prerequisites: [{ id: "old", condition: "{}" }],
      }),
    ).toEqual({
      id: "frev_3_new",
      featureId: "new",
      prerequisites: [{ id: "new", condition: "{}" }],
    });
    expect(
      rewrite("featurerevisions", {
        id: "frev_abc123",
        featureId: "old",
        version: 3,
      }),
    ).toEqual({ featureId: "new" });
    expect(
      rewrite("holdouts", {
        linkedFeatures: {
          old: { id: "old", dateAdded: new Date(0) },
          kept: { id: "kept", dateAdded: new Date(0) },
        },
      }),
    ).toEqual({
      linkedFeatures: {
        new: { id: "new", dateAdded: new Date(0) },
        kept: { id: "kept", dateAdded: new Date(0) },
      },
    });
    expect(
      rewrite("experiments", {
        linkedFeatures: ["old", "kept"],
        pendingFeatureDrafts: [{ featureId: "old", revisionVersion: 2 }],
      }),
    ).toEqual({
      linkedFeatures: ["new", "kept"],
      pendingFeatureDrafts: [{ featureId: "new", revisionVersion: 2 }],
    });
    expect(
      rewrite("rampschedules", {
        entityType: "feature",
        entityId: "old",
        targets: [{ entityType: "feature", entityId: "old", id: "t" }],
      }),
    ).toEqual({
      entityId: "new",
      targets: [{ entityType: "feature", entityId: "new", id: "t" }],
    });
    expect(
      rewrite("discussions", { parentType: "experiment", parentId: "old" }),
    ).toBeNull();
    expect(
      rewrite("features", {
        legacyDraft: { featureId: "old", prerequisites: [{ id: "old" }] },
      }),
    ).toEqual({
      legacyDraft: { featureId: "new", prerequisites: [{ id: "new" }] },
    });
  });
});
