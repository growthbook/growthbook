import { v4 as uuidv4 } from "uuid";
import type { AuditInterfaceInput } from "shared/types/audit";
import type {
  Changeset,
  ExperimentInterface,
  Variation,
} from "shared/types/experiment";
import type { VisualChangesetInterface } from "shared/types/visual-changeset";
import type {
  ApiExperiment,
  ExperimentInterfaceExcludingHoldouts,
  PhaseVariation,
} from "shared/validators";
import { getLatestPhaseVariations } from "shared/experiments";
import { getAffectedEnvsForExperiment } from "shared/util";
import type { ReqContext } from "back-end/types/request";
import type { ApiReqContext } from "back-end/types/api";
import {
  getExperimentById,
  getPayloadKeys,
  updateExperiment,
} from "back-end/src/models/ExperimentModel";
import { queueSDKPayloadRefresh } from "back-end/src/services/features";
import { auditDetailsUpdate } from "back-end/src/services/audit";
import { getEnvironments } from "back-end/src/util/organization.util";
import { logger } from "back-end/src/util/logger";
import { toExperimentApiInterface } from "back-end/src/services/experiments";
import { validateExperimentChange } from "back-end/src/services/experimentChanges/changeExperimentStatus";
import { resolveOwnerEmail } from "back-end/src/services/owner";

export type ChangesetOwnerKind = "experiment";

export type OwnerVariation = Pick<
  Variation,
  "id" | "key" | "name" | "description"
> & { status?: "active" | "pending" | "deactivated" };

type ChangesetPayloadEvent = "created" | "updated" | "deleted";

type WriteReq = {
  context: ApiReqContext;
  audit: (data: AuditInterfaceInput) => Promise<void>;
};

type PromptContext = {
  kind: ChangesetOwnerKind;
  id: string;
  name: string;
  hypothesis?: string;
  description?: string;
  project?: string;
};

export interface ChangesetOwner {
  readonly kind: ChangesetOwnerKind;
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly archived: boolean;
  readonly project: string;
  readonly dateUpdated: Date | string | undefined;

  editableVariations(): OwnerVariation[];
  isEditable(): boolean;

  canUpdateVisualChange(): boolean;
  canUpdateOwner(): boolean;
  canCreateChangeset(): boolean;
  canManageVariations(): boolean;
  requireWrite(
    req: WriteReq,
    opts: { allowRunning: boolean; visualChangesetId: string },
  ): () => Promise<void>;

  setHasVisualChangesets(value: boolean): Promise<void>;
  refreshPayloads(
    event: ChangesetPayloadEvent,
    changesetId: string,
  ): Promise<void>;

  rename(name: string): Promise<string>;
  addVariation(opts: {
    name?: string;
    sourceVariationId?: string;
  }): Promise<{ id: string; name: string }>;
  removeVariation(id: string): Promise<RemoveVariationResult>;
  renameVariation(id: string, name: string): Promise<string>;

  toEditorExperiment(): Promise<ApiExperiment | null>;
  promptContext(): PromptContext;
}

type Ctx = ReqContext | ApiReqContext;

type RemoveVariationResult = { rollback?: () => Promise<void> };

export class ExperimentChangesetOwner implements ChangesetOwner {
  readonly kind = "experiment" as const;
  constructor(
    private readonly context: Ctx,
    public experiment: ExperimentInterface,
  ) {}

  get id() {
    return this.experiment.id;
  }
  get name() {
    return this.experiment.name;
  }
  get status() {
    return this.experiment.status;
  }
  get archived() {
    return !!this.experiment.archived;
  }
  get project() {
    return this.experiment.project ?? "";
  }
  get dateUpdated() {
    return this.experiment.dateUpdated ?? this.experiment.dateCreated;
  }

  editableVariations(): OwnerVariation[] {
    return getLatestPhaseVariations(this.experiment).map((v) => ({
      id: v.id,
      key: v.key,
      name: v.name,
      description: v.description,
    }));
  }
  isEditable(): boolean {
    return !this.archived && this.status === "draft";
  }

  canUpdateVisualChange(): boolean {
    return this.context.permissions.canUpdateVisualChange(this.experiment);
  }
  canUpdateOwner(): boolean {
    return this.context.permissions.canUpdateExperiment(this.experiment, {});
  }
  canCreateChangeset(): boolean {
    return (
      this.context.permissions.canUpdateExperiment(this.experiment, {}) &&
      this.context.permissions.canCreateVisualChange({
        project: this.experiment.project,
      })
    );
  }
  canManageVariations(): boolean {
    return (
      this.context.permissions.canUpdateExperiment(this.experiment, {}) &&
      this.context.permissions.canUpdateVisualChange(this.experiment)
    );
  }
  requireWrite(
    req: WriteReq,
    opts: { allowRunning: boolean; visualChangesetId: string },
  ): () => Promise<void> {
    return requireVisualChangeWrite(req, this.experiment, opts);
  }

  async setHasVisualChangesets(value: boolean): Promise<void> {
    if (!!this.experiment.hasVisualChangesets === value) return;
    this.experiment = await updateExperiment({
      context: this.context,
      experiment: this.experiment,
      changes: { hasVisualChangesets: value },
      bypassWebhooks: true,
    });
  }

  async refreshPayloads(
    event: ChangesetPayloadEvent,
    changesetId: string,
  ): Promise<void> {
    const payloadKeys = getPayloadKeys(this.context, this.experiment);
    queueSDKPayloadRefresh({
      context: this.context,
      payloadKeys,
      auditContext: { event, model: "visualchangeset", id: changesetId },
    });
  }

  async rename(name: string): Promise<string> {
    const trimmed = name.trim();
    if (trimmed === this.experiment.name) return trimmed;
    const changes: Changeset = { name: trimmed };
    await validateExperimentChange({
      context: this.context,
      experiment: this.experiment,
      changes,
    });
    this.experiment = await updateExperiment({
      context: this.context,
      experiment: this.experiment,
      changes,
    });
    return trimmed;
  }

  async addVariation({
    name,
    sourceVariationId,
  }: {
    name?: string;
    sourceVariationId?: string;
  }): Promise<{ id: string; name: string }> {
    const experiment = this.experiment;
    const sourceVariation = sourceVariationId
      ? experiment.variations.find((v) => v.id === sourceVariationId)
      : undefined;
    if (sourceVariationId && !sourceVariation) {
      throw new Error("Source variation not found in this experiment");
    }

    const nextIndex = experiment.variations.length;
    const newVariationId = uuidv4();
    const defaultName = sourceVariation
      ? `${sourceVariation.name} (copy)`
      : `Variant ${nextIndex}`;
    const newVariationName = name?.trim() || defaultName;

    const nextVariations = [
      ...experiment.variations,
      {
        id: newVariationId,
        key: `${nextIndex}`,
        name: newVariationName,
        description: "",
        screenshots: [],
      },
    ];

    const phases = (experiment.phases || []).map((p) => ({ ...p }));
    if (phases.length > 0) {
      const latest = phases[phases.length - 1];
      if (latest.variations !== undefined) {
        const newPhaseVariations: PhaseVariation[] = [
          ...latest.variations,
          { id: newVariationId, status: "active" },
        ];
        latest.variations = newPhaseVariations;
      }
      if (
        latest.variationWeights !== undefined &&
        latest.variationWeights.length > 0
      ) {
        const n = nextVariations.length;
        const equal = Number((1 / n).toFixed(4));
        const weights = new Array(n).fill(equal);
        const sum = weights.reduce((a, b) => a + b, 0);
        weights[0] = Number((weights[0] + (1 - sum)).toFixed(4));
        latest.variationWeights = weights;
      }
    }

    const changes: Changeset = {
      variations: nextVariations,
      ...(phases.length > 0 ? { phases } : {}),
    };
    await validateExperimentChange({
      context: this.context,
      experiment,
      changes,
    });
    this.experiment = await updateExperiment({
      context: this.context,
      experiment,
      changes,
    });

    return { id: newVariationId, name: newVariationName };
  }

  async removeVariation(variationId: string): Promise<RemoveVariationResult> {
    const experiment = this.experiment;
    const idx = experiment.variations.findIndex((v) => v.id === variationId);
    if (idx < 0) {
      throw new Error("Variation not found in this experiment");
    }
    if (idx === 0) {
      throw new Error("The control variation can't be deleted");
    }
    if (experiment.variations.length <= 2) {
      throw new Error(
        "An experiment must keep at least one variant besides control",
      );
    }

    const nextVariations = experiment.variations.filter(
      (v) => v.id !== variationId,
    );
    const originalCount = experiment.variations.length;
    const phases = (experiment.phases || []).map((p) => ({ ...p }));
    if (phases.length > 0) {
      const latest = phases[phases.length - 1];
      if (latest.variations !== undefined) {
        latest.variations = latest.variations.filter(
          (pv) => pv.id !== variationId,
        );
      }
      if (
        latest.variationWeights !== undefined &&
        latest.variationWeights.length
      ) {
        latest.variationWeights =
          latest.variationWeights.length === originalCount
            ? renormalizeWeights(
                latest.variationWeights.filter((_, i) => i !== idx),
              )
            : renormalizeWeights(new Array(nextVariations.length).fill(1));
      }
    }

    const changes: Changeset = {
      variations: nextVariations,
      ...(phases.length > 0 ? { phases } : {}),
    };
    await validateExperimentChange({
      context: this.context,
      experiment,
      changes,
    });

    const rollbackChanges: Changeset = {
      variations: experiment.variations.map((v) => ({ ...v })),
      ...(experiment.phases
        ? { phases: experiment.phases.map((p) => ({ ...p })) }
        : {}),
    };
    const deleted = await updateExperiment({
      context: this.context,
      experiment,
      changes,
    });
    this.experiment = deleted;

    return {
      rollback: async () => {
        this.experiment = await updateExperiment({
          context: this.context,
          experiment: deleted,
          changes: rollbackChanges,
        });
      },
    };
  }

  async renameVariation(variationId: string, name: string): Promise<string> {
    const experiment = this.experiment;
    const idx = experiment.variations.findIndex((v) => v.id === variationId);
    if (idx < 0) {
      throw new Error("Variation not found in this experiment");
    }
    const trimmed = name.trim();
    if (trimmed === experiment.variations[idx].name) return trimmed;
    const nextVariations = experiment.variations.map((v, i) =>
      i === idx ? { ...v, name: trimmed } : v,
    );
    const changes: Changeset = { variations: nextVariations };
    await validateExperimentChange({
      context: this.context,
      experiment,
      changes,
    });
    this.experiment = await updateExperiment({
      context: this.context,
      experiment,
      changes,
    });
    return trimmed;
  }

  async toEditorExperiment(): Promise<ApiExperiment | null> {
    const experiment = await getExperimentById(
      this.context,
      this.experiment.id,
    );
    if (!experiment) return null;
    this.experiment = experiment;
    if (experiment.type === "holdout") return null;
    return resolveOwnerEmail(
      await toExperimentApiInterface(
        this.context,
        experiment as ExperimentInterfaceExcludingHoldouts,
      ),
      this.context,
    );
  }

  promptContext(): PromptContext {
    return {
      kind: this.kind,
      id: this.experiment.id,
      name: this.experiment.name,
      hypothesis: this.experiment.hypothesis || undefined,
      description: this.experiment.description || undefined,
      project: this.experiment.project || undefined,
    };
  }
}

export async function resolveChangesetOwner(
  context: Ctx,
  changeset: Pick<VisualChangesetInterface, "experiment">,
): Promise<ChangesetOwner | null> {
  const experiment = await getExperimentById(context, changeset.experiment);
  return experiment ? new ExperimentChangesetOwner(context, experiment) : null;
}

export function ownerNotFoundMessage(): string {
  return "Experiment not found";
}

function renormalizeWeights(weights: number[]): number[] {
  if (weights.length === 0) return weights;
  const sum = weights.reduce((a, b) => a + b, 0);
  const base =
    sum > 0
      ? weights.map((w) => Number((w / sum).toFixed(4)))
      : new Array(weights.length).fill(Number((1 / weights.length).toFixed(4)));
  const drift = Number((1 - base.reduce((a, b) => a + b, 0)).toFixed(4));
  base[0] = Number((base[0] + drift).toFixed(4));
  return base;
}

function requireDraftExperiment(
  context: ApiReqContext,
  experiment: { status: string; archived: boolean },
  { allowRunning = false }: { allowRunning?: boolean } = {},
): void {
  if (allowRunning && !experiment.archived && experiment.status === "running") {
    return;
  }
  if (experiment.archived || experiment.status !== "draft") {
    context.throwBadRequestError(
      `Only draft experiments can have their visual changes edited (this experiment is ${
        experiment.archived ? "archived" : experiment.status
      }). Set it back to draft in GrowthBook to make changes.`,
    );
  }
}

function requireVisualChangeWrite(
  req: {
    context: ApiReqContext;
    audit: (data: AuditInterfaceInput) => Promise<void>;
  },
  experiment: ExperimentInterface,
  {
    allowRunning,
    visualChangesetId,
  }: { allowRunning: boolean; visualChangesetId: string },
): () => Promise<void> {
  requireDraftExperiment(req.context, experiment, { allowRunning });
  if (experiment.status !== "running") return async () => {};

  const envs = getAffectedEnvsForExperiment({
    experiment: { ...experiment, hasVisualChangesets: true },
    orgEnvironments: getEnvironments(req.context.org),
  });
  if (!req.context.permissions.canRunExperiment(experiment, envs)) {
    req.context.permissions.throwPermissionError();
  }
  return () =>
    req
      .audit({
        event: "experiment.update",
        entity: { object: "experiment", id: experiment.id },
        details: auditDetailsUpdate(experiment, experiment, {
          visualChangesetId,
          liveVisualChangeEdit: true,
        }),
      })
      .catch((err) =>
        logger.error(
          { err, experimentId: experiment.id, visualChangesetId },
          "Failed to audit a live visual change edit",
        ),
      );
}
