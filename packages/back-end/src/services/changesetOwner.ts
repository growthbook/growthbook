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
  ContextualBanditInterface,
  ExperimentInterfaceExcludingHoldouts,
  PhaseVariation,
} from "shared/validators";
import {
  getActiveVariations,
  getLatestPhaseVariations,
  getVisibleVariations,
} from "shared/experiments";
import type { ReqContext } from "back-end/types/request";
import type { ApiReqContext } from "back-end/types/api";
import {
  getExperimentById,
  getPayloadKeys,
  updateExperiment,
} from "back-end/src/models/ExperimentModel";
import { queueSDKPayloadRefresh } from "back-end/src/services/features";
import { refreshLinkedFeaturePayloads } from "back-end/src/services/contextualBanditChanges";
import { toExperimentApiInterface } from "back-end/src/services/experiments";
import { validateExperimentChange } from "back-end/src/services/experimentChanges/changeExperimentStatus";
import { resolveOwnerEmail } from "back-end/src/services/owner";
import { requireVisualChangeWrite } from "back-end/src/api/visual-editor-ai/requireDraftExperiment";

export type ChangesetOwnerKind = "experiment" | "contextual-bandit";

export type OwnerVariation = Pick<
  Variation,
  "id" | "key" | "name" | "description"
> & { status?: "active" | "pending" | "deactivated" };

export type ChangesetPayloadEvent = "created" | "updated" | "deleted";

type WriteReq = {
  context: ApiReqContext;
  audit: (data: AuditInterfaceInput) => Promise<void>;
};

export type EditorExperiment = {
  id: string;
  trackingKey: string;
  name: string;
  status: string;
  project: string;
  hashAttribute: string;
  hashVersion: 2;
  type: "contextual-bandit";
  variations: Array<{
    variationId: string;
    key: string;
    name: string;
    description: string;
    status?: OwnerVariation["status"];
  }>;
};

export type PromptContext = {
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
  readonly trackingKey: string;
  readonly hashAttribute: string;
  readonly hasVisualChangesets: boolean;
  readonly dateUpdated: Date | string | undefined;

  editableVariations(): OwnerVariation[];
  servedVariations(): OwnerVariation[];
  isEditable(): boolean;

  canUpdate(): boolean;
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
  removeVariation(id: string): Promise<{ rollback: () => Promise<void> }>;
  renameVariation(id: string, name: string): Promise<string>;

  toEditorExperiment(): Promise<ApiExperiment | EditorExperiment | null>;
  promptContext(): PromptContext;
}

type Ctx = ReqContext | ApiReqContext;

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
  get trackingKey() {
    return this.experiment.trackingKey;
  }
  get hashAttribute() {
    return this.experiment.hashAttribute;
  }
  get hasVisualChangesets() {
    return !!this.experiment.hasVisualChangesets;
  }
  get dateUpdated() {
    return this.experiment.dateUpdated ?? this.experiment.dateCreated;
  }

  editableVariations(): OwnerVariation[] {
    return this.experiment.variations;
  }
  servedVariations(): OwnerVariation[] {
    return getLatestPhaseVariations(this.experiment);
  }
  isEditable(): boolean {
    return !this.archived && this.status === "draft";
  }

  canUpdate(): boolean {
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

  async removeVariation(
    variationId: string,
  ): Promise<{ rollback: () => Promise<void> }> {
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
      id: this.experiment.id,
      name: this.experiment.name,
      hypothesis: this.experiment.hypothesis || undefined,
      description: this.experiment.description || undefined,
      project: this.experiment.project || undefined,
    };
  }
}

export class ContextualBanditChangesetOwner implements ChangesetOwner {
  readonly kind = "contextual-bandit" as const;
  constructor(
    private readonly context: Ctx,
    public cb: ContextualBanditInterface,
  ) {}

  get id() {
    return this.cb.id;
  }
  get name() {
    return this.cb.name;
  }
  get status() {
    return this.cb.status;
  }
  get archived() {
    return !!this.cb.archived;
  }
  get project() {
    return this.cb.project ?? "";
  }
  get trackingKey() {
    return this.cb.trackingKey;
  }
  get hashAttribute() {
    return this.cb.hashAttribute;
  }
  get hasVisualChangesets() {
    return !!this.cb.hasVisualChangesets;
  }
  get dateUpdated() {
    return this.cb.dateUpdated ?? this.cb.dateCreated;
  }

  editableVariations(): OwnerVariation[] {
    return getVisibleVariations(this.cb.variations);
  }
  servedVariations(): OwnerVariation[] {
    return getActiveVariations(this.cb.variations);
  }
  isEditable(): boolean {
    return !this.archived && this.status !== "stopped";
  }

  canUpdate(): boolean {
    return this.context.permissions.canUpdateContextualBandit(this.cb, this.cb);
  }
  canUpdateOwner(): boolean {
    return this.canUpdate();
  }
  canCreateChangeset(): boolean {
    return this.canUpdate();
  }
  canManageVariations(): boolean {
    return this.canUpdate();
  }
  requireWrite(
    req: WriteReq,
    _opts: { allowRunning: boolean; visualChangesetId: string },
  ): () => Promise<void> {
    if (this.archived || this.status === "stopped") {
      req.context.throwBadRequestError(
        `Only draft or running contextual bandits can have their visual changes edited (this contextual bandit is ${
          this.archived ? "archived" : this.status
        }).`,
      );
    }
    return async () => {};
  }

  async setHasVisualChangesets(value: boolean): Promise<void> {
    if (!!this.cb.hasVisualChangesets === value) return;
    this.cb = await this.context.models.contextualBandits.update(this.cb, {
      hasVisualChangesets: value,
    });
  }

  async refreshPayloads(): Promise<void> {
    await refreshLinkedFeaturePayloads(
      this.context,
      this.cb,
      "contextualBandit.refresh",
    );
  }

  async rename(name: string): Promise<string> {
    const trimmed = name.trim();
    if (trimmed === this.cb.name) return trimmed;
    this.cb = await this.context.models.contextualBandits.update(this.cb, {
      name: trimmed,
    });
    return this.cb.name;
  }

  async addVariation(): Promise<{ id: string; name: string }> {
    throw new Error(VARIATION_CHANGE_UNSUPPORTED);
  }
  async removeVariation(): Promise<{ rollback: () => Promise<void> }> {
    throw new Error(VARIATION_CHANGE_UNSUPPORTED);
  }
  async renameVariation(): Promise<string> {
    throw new Error(VARIATION_CHANGE_UNSUPPORTED);
  }

  async toEditorExperiment(): Promise<EditorExperiment> {
    return {
      id: this.cb.id,
      trackingKey: this.cb.trackingKey,
      name: this.cb.name,
      status: this.cb.status,
      project: this.cb.project ?? "",
      hashAttribute: this.cb.hashAttribute,
      hashVersion: 2,
      type: "contextual-bandit",
      variations: this.editableVariations().map((v) => ({
        variationId: v.id,
        key: v.key,
        name: v.name,
        description: v.description ?? "",
        ...(v.status ? { status: v.status } : {}),
      })),
    };
  }

  promptContext(): PromptContext {
    return {
      id: this.cb.id,
      name: this.cb.name,
      description: this.cb.description || undefined,
      project: this.cb.project || undefined,
    };
  }
}

const VARIATION_CHANGE_UNSUPPORTED =
  "Variation changes for contextual bandits go through the contextual bandit variations modal in GrowthBook.";

export async function resolveChangesetOwner(
  context: Ctx,
  changeset: Pick<VisualChangesetInterface, "experiment" | "contextualBandit">,
): Promise<ChangesetOwner | null> {
  if (changeset.contextualBandit) {
    const cb = await context.models.contextualBandits.getById(
      changeset.contextualBandit,
    );
    return cb ? new ContextualBanditChangesetOwner(context, cb) : null;
  }
  const experiment = await getExperimentById(context, changeset.experiment);
  return experiment ? new ExperimentChangesetOwner(context, experiment) : null;
}

export function ownerNotFoundMessage(
  changeset: Pick<VisualChangesetInterface, "contextualBandit">,
): string {
  return changeset.contextualBandit
    ? "Contextual Bandit not found"
    : "Experiment not found";
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
