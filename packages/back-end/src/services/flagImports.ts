import { z } from "zod";
import {
  buildFlagImportExperimentBody,
  buildFlagImportFeatureBody,
  FlagImportPlan,
  getFlagImportFlags,
  matchConfirmRules,
  planFlagImport,
} from "shared/util";
import {
  ApiFlagImport,
  ConfirmAction,
  FLAG_IMPORT_MAX_BYTES,
  FlagImportResult,
  FlagsJson,
  flagsJsonValidator,
  postFlagImportValidator,
} from "shared/validators";
import {
  claimFlagImport,
  countPendingFlagImports,
  createFlagImport,
  findFlagImportByToken,
  finishFlagImport,
  FlagImportInterface,
} from "back-end/src/models/FlagImportModel";
import { findOrganizationById } from "back-end/src/models/OrganizationModel";
import { getFeature } from "back-end/src/models/FeatureModel";
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

function toApiFlagImport(doc: FlagImportInterface): ApiFlagImport {
  return {
    status: doc.status,
    name: doc.name,
    agent: doc.agent,
    dateCreated: doc.dateCreated.toISOString(),
    expiresAt: doc.expiresAt.toISOString(),
    summary: doc.summary,
    flags: doc.flags,
    warnings: doc.warnings,
    claimed: doc.claimed
      ? { at: doc.claimed.at.toISOString(), results: doc.claimed.results }
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
      "Give claimUrl to your user and repeat it in your last message: opening it and signing in creates these Feature Flags in their GrowthBook workspace.",
      `The link works once and stops on ${expiresAt}.`,
      "GET /api/v1/flag-imports/{token} says when it has been claimed and what was created.",
      ...(plan.warnings.length
        ? [
            "Anything listed in warnings will not be imported as the file stands.",
          ]
        : []),
    ].join(" "),
  };
}

export async function getFlagImportByToken(
  token: string,
): Promise<ApiFlagImport> {
  const doc = await findFlagImportByToken(token);
  if (!doc) {
    throw new FlagImportError(404, "This link has expired or does not exist.");
  }
  return toApiFlagImport(doc);
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
): Promise<void> {
  const existingEnvs = new Set(getEnvironments(context.org).map((e) => e.id));
  for (const env of plan.environments) {
    if (existingEnvs.has(env)) continue;
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
    if (created) await reloadOrganization(context);
  }

  const existingAttributes = new Set(
    (context.org.settings?.attributeSchema ?? []).map((a) => a.property),
  );
  for (const attribute of plan.attributes) {
    if (existingAttributes.has(attribute.property)) continue;
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
): Promise<void> {
  await createMissingSettings(context, plan, results);
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
    ) => results.push({ kind: "feature", key: flag.key, status, message });

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

// Runs every create as the caller, through the same REST handlers a direct
// request would hit, so permissions, plan limits and audit entries match.
export async function claimFlagImportIntoWorkspace(
  context: ApiReqContext,
  token: string,
  options: { project?: string; owner?: string },
): Promise<ApiFlagImport> {
  const pending = await findFlagImportByToken(token);
  if (!pending) {
    throw new FlagImportError(404, "This link has expired or does not exist.");
  }
  if (pending.status === "claimed") {
    throw new FlagImportError(409, "This upload was already claimed.");
  }

  // Checked before the upload is spent, so a refusal leaves it claimable.
  const project = options.project || undefined;
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

  const claimed = await claimFlagImport(pending.id, {
    userId: context.userId || null,
    organization: context.org.id,
  });
  if (!claimed?.file) {
    throw new FlagImportError(409, "This upload was already claimed.");
  }

  const results: FlagImportResult[] = [];
  try {
    const plan = planFlagImport(
      flagsJsonValidator.parse(JSON.parse(claimed.file)),
    );
    await importFlags(
      context,
      plan,
      { project, owner: options.owner },
      results,
    );
  } catch (e) {
    context.logger.error(e, "A flag import stopped part way through");
    results.push({
      kind: "feature",
      key: "",
      status: "failed",
      message: `The import stopped early: ${e instanceof Error ? e.message : String(e)}`,
    });
  }

  const finished = await finishFlagImport(claimed.id, results);
  return toApiFlagImport(
    finished ?? {
      ...claimed,
      file: null,
      status: "claimed",
      claimed: {
        at: new Date(),
        userId: context.userId || null,
        organization: context.org.id,
        results,
      },
    },
  );
}
