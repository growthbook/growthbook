import { buildFullJsonObject, buildMinimalJsonDiffObject } from "shared/util";
import { getFeatureRevisionDiffV2Validator } from "shared/validators";
import { getFeature } from "back-end/src/models/FeatureModel";
import { getRevision } from "back-end/src/models/FeatureRevisionModel";
import {
  getLiveRevisionForFeature,
  revisionToDiffableV2,
} from "back-end/src/services/features";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";

// GET /v2/features/:id/revisions/:version/diff
// Returns a schema-keyed JSON diff between this revision and a baseline. Same
// `Minimal JSON` / `Full JSON` shapes the in-app review surface emits via
// `Copy as`, so review bots and humans see identical payloads. Defaults to
// diffing against the revision's own `baseVersion`; `?base=live` follows the
// currently-live revision, and `?base=<int>` targets a specific historical
// revision. Lifecycle metadata is excluded from the diff body and echoed via
// `from` / `to` instead.
export const getFeatureRevisionDiffV2 = createApiRequestHandler(
  getFeatureRevisionDiffV2Validator,
)(async (req) => {
  const { id, version } = req.params;
  const { format = "minimal", base = "baseVersion" } = req.query;

  const feature = await getFeature(req.context, id);
  if (!feature) throw new NotFoundError("Could not find feature");

  const revision = await getRevision({
    context: req.context,
    organization: req.organization.id,
    featureId: feature.id,
    feature,
    version,
  });
  if (!revision) {
    throw new NotFoundError("Could not find feature revision");
  }

  // Resolve the baseline. `live` re-queries each call because that's the
  // whole point — bots want the net effect against *current* live state.
  let baseVersion: number;
  if (base === "baseVersion") {
    baseVersion = revision.baseVersion;
  } else if (base === "live") {
    const live = await getLiveRevisionForFeature(req.context, feature);
    baseVersion = live.version;
  } else {
    baseVersion = base;
  }

  // Self-diff is a meaningful query (returns an empty change set) — only
  // reject *missing* baselines.
  const baseRevision =
    baseVersion === revision.version
      ? revision
      : await getRevision({
          context: req.context,
          organization: req.organization.id,
          featureId: feature.id,
          feature,
          version: baseVersion,
        });
  if (!baseRevision) {
    throw new BadRequestError(
      `Could not find baseline revision #${baseVersion}`,
    );
  }

  const before = revisionToDiffableV2(baseRevision);
  const after = revisionToDiffableV2(revision);

  const envelope = {
    name: feature.id,
    type: "feature" as const,
    from: baseRevision.version,
    to: revision.version,
  };

  // `before`/`after` are always populated here (synthesized from the loaded
  // revisions), so `buildFullJsonObject` always takes its raw branch — the
  // `fields` form is impossible from this call site. Both formats already
  // handle the empty-change case.
  const buildArgs = {
    entityName: feature.id,
    entityType: "feature",
    diffs: [],
    raw: { before, after },
  };

  if (format === "full") {
    const body = buildFullJsonObject(buildArgs);
    if (!("before" in body)) {
      // Defensive: would only happen if `raw` was somehow stripped upstream.
      throw new Error("Full JSON diff missing whole before/after shapes");
    }
    return {
      diff: {
        ...envelope,
        before: body.before as Record<string, unknown>,
        after: body.after as Record<string, unknown>,
        ...(body.supplemental ? { supplemental: body.supplemental } : {}),
      },
    };
  }

  const body = buildMinimalJsonDiffObject(buildArgs);
  return {
    diff: {
      ...envelope,
      changes: body.changes,
      ...(body.supplemental ? { supplemental: body.supplemental } : {}),
    },
  };
});
