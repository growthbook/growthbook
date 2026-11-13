import { z } from "zod";
import {
  buildFlagImportExperimentBody,
  buildFlagImportFeatureBody,
  FlagImportPlan,
  getFlagImportFlags,
  mapFlagImportEnvironments,
  matchConfirmRules,
  planFlagImport,
  selectFlagImportFlags,
} from "shared/util";
import {
  ApiFlagImport,
  ApiFlagImportStatus,
  AutoRunArtifact,
  ConfirmAction,
  FLAG_IMPORT_MAX_BYTES,
  FLAG_IMPORT_MAX_CLAIMED_PER_WORKSPACE,
  FlagImportChoices,
  FlagImportResult,
  FlagsJson,
  flagsJsonValidator,
  postFlagImportValidator,
} from "shared/validators";
import {
  beginFlagImport,
  claimFlagImport,
  countClaimedFlagImports,
  countPendingFlagImports,
  createFlagImport,
  findFlagImportByToken,
  finishFlagImport,
  FlagImportInterface,
} from "back-end/src/models/FlagImportModel";
import { findOrganizationById } from "back-end/src/models/OrganizationModel";
import { getFeature, getFeaturesByIds } from "back-end/src/models/FeatureModel";
import { dispatchInternal } from "back-end/src/agent/dispatcher";
import { getBackendFeatureValue } from "back-end/src/services/growthbook";
import { getEnvironments } from "back-end/src/services/organizations";
import {
  APP_ORIGIN,
  FLAG_IMPORTS_ENABLED,
  FLAG_IMPORTS_MAX_PENDING,
} from "back-end/src/util/secrets";
import { ApiReqContext } from "back-end/types/api";

type PostFlagImportResponse = z.infer<
  (typeof postFlagImportValidator)["responseSchema"]
>;

export class FlagImportError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "FlagImportError";
  }
}

export function isFlagImportsEnabled(): boolean {
  if (!FLAG_IMPORTS_ENABLED) return false;
  return getBackendFeatureValue("flag-imports", true);
}

// Off means not here, the same as any unknown path.
export function assertFlagImportsEnabled(): void {
  if (!isFlagImportsEnabled()) throw new FlagImportError(404, "Not found");
}

type Artifact = Omit<AutoRunArtifact, "dateCreated">;

const REPORT_ORDER: Artifact["kind"][] = [
  "feature",
  "experiment",
  "environment",
  "attribute",
];

const EXPIRED = "This link has expired or does not exist.";

function toApiStatus(doc: FlagImportInterface): ApiFlagImportStatus {
  return { status: doc.status, expiresAt: doc.expiresAt.toISOString() };
}

async function toApiFlagImport(
  context: ApiReqContext,
  doc: FlagImportInterface,
): Promise<ApiFlagImport> {
  const file = doc.file ? flagsJsonValidator.parse(JSON.parse(doc.file)) : null;
  const existing = file
    ? await getFeaturesByIds(context, Object.keys(file.features))
    : [];
  return {
    status: doc.status,
    name: doc.name,
    agent: doc.agent,
    dateCreated: doc.dateCreated.toISOString(),
    expiresAt: doc.expiresAt.toISOString(),
    file,
    existingFlags: existing.map((feature) => feature.id),
    imported: doc.imported
      ? {
          at: doc.imported.at.toISOString(),
          results: doc.imported.results,
          autoRunUrl: doc.imported.autoRunId
            ? `${APP_ORIGIN}/auto-runs/${doc.imported.autoRunId}?org=${encodeURIComponent(context.org.id)}`
            : null,
        }
      : null,
  };
}

export async function createFlagImportFromFile({
  file,
  name,
  agent,
}: {
  file: FlagsJson;
  name?: string;
  agent?: string;
}): Promise<PostFlagImportResponse> {
  const serialized = JSON.stringify(file);
  if (Buffer.byteLength(serialized) > FLAG_IMPORT_MAX_BYTES) {
    throw new FlagImportError(
      413,
      `The file is larger than ${FLAG_IMPORT_MAX_BYTES / 1024} KB.`,
    );
  }

  const plan = planFlagImport(file);
  const flags = getFlagImportFlags(plan);
  if (!flags.some((flag) => flag.importable)) {
    throw new FlagImportError(
      400,
      [
        "Nothing in this file can be imported.",
        ...plan.warnings.map((w) => `[${w.path}] ${w.message}`),
      ].join("\n"),
    );
  }

  if ((await countPendingFlagImports()) >= FLAG_IMPORTS_MAX_PENDING) {
    throw new FlagImportError(
      429,
      `GrowthBook is holding as many unclaimed uploads as it allows. Try again later, or sign up at ${APP_ORIGIN}.`,
    );
  }

  const { token, flagImport } = await createFlagImport({
    file: serialized,
    name: name?.trim() || null,
    agent: agent?.trim() || null,
    summary: plan.summary,
    flags,
    warnings: plan.warnings,
  });

  const expiresAt = flagImport.expiresAt.toISOString();
  return {
    token,
    claimUrl: `${APP_ORIGIN}/claim/${token}`,
    expiresAt,
    summary: plan.summary,
    warnings: plan.warnings,
    howToUse: [
      "Give claimUrl to your user and repeat it in your last message: opening it and signing in lets them import these Feature Flags into their GrowthBook workspace.",
      `The link works once and stops on ${expiresAt}.`,
      "GET /api/v1/flag-imports/{token} says when it has been claimed and when it has been imported.",
      ...(plan.warnings.length
        ? [
            "Anything listed in warnings will not be imported as the file stands.",
          ]
        : []),
    ].join(" "),
  };
}

export async function getFlagImportStatusByToken(
  token: string,
): Promise<ApiFlagImportStatus> {
  const doc = await findFlagImportByToken(token);
  if (!doc) throw new FlagImportError(404, EXPIRED);
  return toApiStatus(doc);
}

const createdExperiment = z.object({
  experiment: z.object({
    id: z.string(),
    variations: z.array(z.object({ variationId: z.string() })),
  }),
});

function errorMessage(body: unknown): string {
  const parsed = z.object({ message: z.string() }).safeParse(body);
  return parsed.success ? parsed.data.message : "The request failed";
}

// Environments and attributes live on the organization document, and each
// create writes the whole list from the context's copy. Reload it between
// writes or the second one undoes the first.
async function reloadOrganization(context: ApiReqContext): Promise<void> {
  const org = await findOrganizationById(context.org.id);
  if (org) context.org = org;
}

async function createMissingSettings(
  context: ApiReqContext,
  plan: FlagImportPlan,
  results: FlagImportResult[],
  artifacts: Artifact[],
): Promise<void> {
  const existingEnvs = new Set(getEnvironments(context.org).map((e) => e.id));
  for (const env of plan.environments) {
    const artifact = (action: Artifact["action"], detail: string | null) =>
      artifacts.push({
        kind: "environment",
        id: env,
        label: env,
        by: "growthbook",
        detail,
        action,
      });
    if (existingEnvs.has(env)) {
      artifact("existing", null);
      continue;
    }
    const { status, body } = await dispatchInternal(context, {
      method: "POST",
      path: "/api/v1/environments",
      body: { id: env },
    });
    const created = status === 200;
    results.push({
      kind: "environment",
      key: env,
      status: created ? "created" : "failed",
      message: created ? null : errorMessage(body),
    });
    artifact(
      created ? "created" : "failed",
      created ? null : errorMessage(body),
    );
    if (created) await reloadOrganization(context);
  }

  const existingAttributes = new Set(
    (context.org.settings?.attributeSchema ?? []).map((a) => a.property),
  );
  for (const attribute of plan.attributes) {
    const artifact = (action: Artifact["action"], detail: string | null) =>
      artifacts.push({
        kind: "attribute",
        id: attribute.property,
        label: attribute.property,
        by: "growthbook",
        detail,
        action,
      });
    if (existingAttributes.has(attribute.property)) {
      artifact("existing", null);
      continue;
    }
    const { status, body } = await dispatchInternal(context, {
      method: "POST",
      path: "/api/v1/attributes",
      body: {
        property: attribute.property,
        datatype: attribute.datatype,
        ...(attribute.hashAttribute && { hashAttribute: true }),
        ...(attribute.format && { format: attribute.format }),
      },
    });
    const created = status === 200;
    results.push({
      kind: "attribute",
      key: attribute.property,
      status: created ? "created" : "failed",
      message: created ? null : errorMessage(body),
    });
    artifact(
      created ? "created" : "failed",
      created ? attribute.datatype : errorMessage(body),
    );
    if (created) await reloadOrganization(context);
  }
}

type CreatedExperiment = { id: string; variationIds: string[] } | string;

const CLAIM_ACTIONS: ConfirmAction[] = [
  "feature.create",
  "feature.publish",
  "experiment.create",
  "environment.create",
  "attribute.create",
];

async function importFlags(
  context: ApiReqContext,
  plan: FlagImportPlan,
  { project, owner }: { project?: string; owner?: string },
  results: FlagImportResult[],
  artifacts: Artifact[],
): Promise<void> {
  await createMissingSettings(context, plan, results, artifacts);
  const environmentIds = getEnvironments(context.org).map((e) => e.id);

  // Keyed by tracking key; a string is why it could not be created.
  const experiments = new Map<string, CreatedExperiment>();
  const ensureExperiment = async (
    trackingKey: string,
  ): Promise<CreatedExperiment> => {
    const known = experiments.get(trackingKey);
    if (known) return known;
    const experiment = plan.experiments.find(
      (e) => e.trackingKey === trackingKey,
    );
    if (!experiment) throw new Error(`Missing experiment ${trackingKey}`);

    const { status, body } = await dispatchInternal(context, {
      method: "POST",
      path: "/api/v1/experiments",
      body: buildFlagImportExperimentBody(experiment, {
        project,
        owner,
        dateStarted: new Date().toISOString(),
      }),
    });
    const parsed = createdExperiment.safeParse(body);
    const outcome: CreatedExperiment =
      status === 200 && parsed.success
        ? {
            id: parsed.data.experiment.id,
            variationIds: parsed.data.experiment.variations.map(
              (v) => v.variationId,
            ),
          }
        : errorMessage(body);
    experiments.set(trackingKey, outcome);
    artifacts.push({
      kind: "experiment",
      id: typeof outcome === "string" ? trackingKey : outcome.id,
      label: experiment.name,
      by: "developer",
      detail:
        typeof outcome === "string"
          ? outcome
          : `Draft, ${experiment.variations.length} variations`,
      action: typeof outcome === "string" ? "failed" : "created",
    });
    results.push({
      kind: "experiment",
      key: trackingKey,
      status: typeof outcome === "string" ? "failed" : "created",
      message:
        typeof outcome === "string"
          ? outcome
          : "Experiment created as a draft. Start it in GrowthBook.",
    });
    return outcome;
  };

  for (const flag of plan.flags) {
    const result = (
      status: FlagImportResult["status"],
      message: string | null,
    ) => {
      results.push({ kind: "feature", key: flag.key, status, message });
      artifacts.push({
        kind: "feature",
        id: flag.key,
        label: flag.key,
        by: "developer",
        detail:
          status === "created"
            ? `${flag.valueType}, ${flag.ruleCount} ${flag.ruleCount === 1 ? "rule" : "rules"}`
            : message,
        action:
          status === "created"
            ? "created"
            : status === "exists"
              ? "existing"
              : "failed",
      });
    };

    if (flag.unsupported.length) {
      result("skipped", flag.unsupported.join(". "));
      continue;
    }
    if (await getFeature(context, flag.key)) {
      result("exists", "A Feature Flag with this key already exists.");
      continue;
    }

    const linked: Record<string, { id: string; variationIds: string[] }> = {};
    let blocked: string | null = null;
    for (const rule of flag.rules) {
      if (rule.type !== "experiment") continue;
      const experiment = await ensureExperiment(rule.trackingKey);
      if (typeof experiment === "string") {
        blocked = `Its experiment ${rule.trackingKey} could not be created: ${experiment}`;
        break;
      }
      linked[rule.trackingKey] = experiment;
    }
    if (blocked) {
      result("failed", blocked);
      continue;
    }

    const { body: createBody, droppedRules } = buildFlagImportFeatureBody(
      flag,
      { project, owner, environmentIds, experiments: linked },
    );
    const { status, body } = await dispatchInternal(context, {
      method: "POST",
      path: "/api/v2/features",
      body: createBody,
    });
    if (status === 200) {
      result(
        "created",
        droppedRules
          ? `${droppedRules} ${droppedRules === 1 ? "rule was" : "rules were"} left out because none of ${droppedRules === 1 ? "its" : "their"} environments exist in this workspace.`
          : null,
      );
    } else {
      result(status === 202 ? "skipped" : "failed", errorMessage(body));
    }
  }
}

function assertClaimedBy(
  context: ApiReqContext,
  doc: FlagImportInterface,
): void {
  if (doc.claimed?.organization !== context.org.id) {
    throw new FlagImportError(
      403,
      "This upload was claimed in another workspace.",
    );
  }
}

// Ties the upload to the caller's workspace. Nothing is created yet.
export async function claimFlagImportForWorkspace(
  context: ApiReqContext,
  token: string,
): Promise<ApiFlagImport> {
  const found = await findFlagImportByToken(token);
  if (!found) throw new FlagImportError(404, EXPIRED);

  let doc = found;
  if (doc.status === "pending") {
    // Claimed uploads are outside the cap on unclaimed ones, so bound them here.
    if (
      (await countClaimedFlagImports(context.org.id)) >=
      FLAG_IMPORT_MAX_CLAIMED_PER_WORKSPACE
    ) {
      throw new FlagImportError(
        429,
        "This workspace has as many claimed uploads waiting as it can hold. Import one, or wait for one to expire.",
      );
    }
    const claimed = await claimFlagImport(doc.id, {
      userId: context.userId || null,
      organization: context.org.id,
    });
    // Someone else took it between the two calls: see who.
    const current = claimed ?? (await findFlagImportByToken(token));
    if (!current) throw new FlagImportError(404, EXPIRED);
    doc = current;
  }
  assertClaimedBy(context, doc);
  return toApiFlagImport(context, doc);
}

export async function getFlagImportDetails(
  context: ApiReqContext,
  token: string,
): Promise<ApiFlagImport> {
  const doc = await findFlagImportByToken(token);
  if (!doc) throw new FlagImportError(404, EXPIRED);
  if (doc.status === "pending") {
    throw new FlagImportError(409, "This upload has not been claimed yet.");
  }
  assertClaimedBy(context, doc);
  return toApiFlagImport(context, doc);
}

async function recordAutoRun(
  context: ApiReqContext,
  doc: FlagImportInterface,
  results: FlagImportResult[],
  artifacts: Artifact[],
): Promise<string | null> {
  const created = results.some((r) => r.status === "created");
  const failed = results.some(
    (r) => r.status === "failed" || r.status === "skipped",
  );
  try {
    const now = new Date();
    const run = await context.models.autoRuns.create({
      source: "flags-import",
      agent: doc.agent?.slice(0, 50) ?? null,
      createdBy: context.userId || null,
      metadata: {
        flagImportId: doc.id,
        ...(doc.name ? { appName: doc.name } : {}),
      },
      // The report lists them in this order: what the person brought first.
      artifacts: [...artifacts]
        .sort(
          (a, b) => REPORT_ORDER.indexOf(a.kind) - REPORT_ORDER.indexOf(b.kind),
        )
        .map((artifact) => ({
          ...artifact,
          detail: artifact.detail?.slice(0, 500) ?? null,
          dateCreated: now,
        })),
      checks: [],
      outcome: !failed ? "completed" : created ? "partial" : "failed",
      failureReason: null,
      dateCompleted: now,
    });
    return run.id;
  } catch (e) {
    context.logger.error(e, "A flag import could not be recorded as a run");
    return null;
  }
}

// Runs every create as the caller, through the same REST handlers a direct
// request would hit, so permissions, plan limits and audit entries match.
export async function importClaimedFlags(
  context: ApiReqContext,
  token: string,
  {
    project: chosenProject,
    owner,
    ...choices
  }: FlagImportChoices & { project?: string; owner?: string },
): Promise<ApiFlagImport> {
  const claimed = await findFlagImportByToken(token);
  if (!claimed) throw new FlagImportError(404, EXPIRED);
  if (claimed.status === "pending") {
    throw new FlagImportError(409, "This upload has not been claimed yet.");
  }
  assertClaimedBy(context, claimed);
  if (claimed.status === "imported") {
    throw new FlagImportError(409, "This upload was already imported.");
  }

  // Checked before the upload is spent, so a refusal leaves it importable.
  const project = chosenProject || undefined;
  if (project && !(await context.models.projects.getById(project))) {
    throw new FlagImportError(400, `Project ${project} does not exist.`);
  }
  if (!project && context.org.settings?.requireProjectForFeatures) {
    throw new FlagImportError(
      400,
      "This workspace requires a Project for new Feature Flags. Choose one.",
    );
  }
  if (
    !context.permissions.canCreateFeature(
      { project: project ?? "" },
      getEnvironments(context.org).map((e) => e.id),
    )
  ) {
    context.permissions.throwPermissionError();
  }
  // Each create would stop for its own confirmation part way through.
  const confirmRules = context.isApiRequest
    ? (context.apiKeyData?.confirmRules ?? [])
    : [];
  if (
    matchConfirmRules(
      confirmRules,
      CLAIM_ACTIONS.map((action) => ({ action, environments: [] })),
    ).length
  ) {
    throw new FlagImportError(
      403,
      "This API key needs a person's confirmation before it writes. Open the claim link in a browser to import.",
    );
  }

  const begun = await beginFlagImport(claimed.id, {
    userId: context.userId || null,
    organization: context.org.id,
  });
  if (!begun?.file) {
    throw new FlagImportError(409, "This upload was already imported.");
  }

  const results: FlagImportResult[] = [];
  const artifacts: Artifact[] = [];
  try {
    const file = selectFlagImportFlags(
      flagsJsonValidator.parse(JSON.parse(begun.file)),
      choices.flags,
    );
    const plan = mapFlagImportEnvironments(
      planFlagImport(file, { rules: choices.rules }),
      choices.environments,
    );
    await importFlags(context, plan, { project, owner }, results, artifacts);
  } catch (e) {
    context.logger.error(e, "A flag import stopped part way through");
    results.push({
      kind: "feature",
      key: "",
      status: "failed",
      message: `The import stopped early: ${e instanceof Error ? e.message : String(e)}`,
    });
  }

  const autoRunId = await recordAutoRun(context, begun, results, artifacts);
  const finished = await finishFlagImport(begun.id, { results, autoRunId });
  return toApiFlagImport(
    context,
    finished ?? {
      ...begun,
      file: null,
      status: "imported",
      imported: {
        at: new Date(),
        userId: context.userId || null,
        autoRunId,
        results,
      },
    },
  );
}
