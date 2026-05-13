import { getAffectedEnvsForExperiment } from "shared/util";
import {
  ContextualBanditInterface,
  contextualBanditValidator,
  LeafWeight,
} from "shared/validators";
import { MakeModelClass } from "./BaseModel";

const BaseClass = MakeModelClass({
  schema: contextualBanditValidator,
  collectionName: "contextualbandits",
  idPrefix: "cb_",
  auditLog: {
    entity: "contextualBandit",
    createEvent: "contextualBandit.create",
    updateEvent: "contextualBandit.update",
    deleteEvent: "contextualBandit.delete",
  },
  globallyUniquePrimaryKeys: false,
  // 1:1 with experiment via the unique (organization, experiment) index.
  // CBAQ index supports the orchestrator's "list CBs that depend on this
  // CBAQ" reverse lookup before deleting / refreshing a CBAQ.
  additionalIndexes: [
    { fields: { organization: 1, experiment: 1 }, unique: true },
    { fields: { organization: 1, cbaqId: 1 } },
  ],
  // `experiment` and `cbaqId` are immutable references — the orchestrator
  // mints a new CB doc when the parent experiment is re-keyed rather than
  // re-pointing an existing CB doc.
  readonlyFields: ["experiment", "cbaqId"],
  // Mirrors the field-level defaults the user spec called for. Defaults
  // live here (not on the Zod schema) per the project rule against
  // `.default()` — keeps the inferred type "field is required" while
  // letting BaseModel populate them on create.
  defaultValues: {
    contextualAttributes: [],
    maxContexts: 300,
    treeModel: "regression_tree",
    minUsersPerLeaf: 100,
    maxLeaves: 12,
    holdoutPercent: 0,
    stickyBucketing: false,
    canonicalFormVersion: "v1",
    phases: [],
  },
});

export class ContextualBanditModel extends BaseClass {
  // Permissioning mirrors the URLRedirectModel pattern: child of an
  // experiment, so we defer to the parent experiment's project /
  // run-experiment permissions. The experiment doc is loaded via
  // `getForeignRefs` (the BaseModel auto-detects `experiment` as a
  // foreign key) — the framework calls `populateForeignRefs` for us
  // before invoking `canRead` on each doc.
  protected canRead(doc: ContextualBanditInterface): boolean {
    const { experiment } = this.getForeignRefs(doc);
    if (!experiment) {
      // CB doc whose parent experiment is missing or inaccessible —
      // refuse rather than leak. Orchestrator paths that legitimately
      // need to bypass this should use `dangerousGetCollection()` /
      // `dangerousUpdateBypassPermission`.
      return false;
    }
    return this.context.permissions.canReadSingleProjectResource(
      experiment.project,
    );
  }

  private canWrite(doc: ContextualBanditInterface): boolean {
    const { experiment } = this.getForeignRefs(doc);
    if (!experiment) return false;
    const envs = getAffectedEnvsForExperiment({
      experiment,
      orgEnvironments: this.context.org.settings?.environments || [],
    });
    return this.context.permissions.canRunExperiment(experiment, envs);
  }

  protected canCreate(doc: ContextualBanditInterface): boolean {
    return this.canWrite(doc);
  }

  protected canUpdate(existing: ContextualBanditInterface): boolean {
    return this.canWrite(existing);
  }

  protected canDelete(existing: ContextualBanditInterface): boolean {
    return this.canWrite(existing);
  }

  protected async customValidation(
    doc: ContextualBanditInterface,
  ): Promise<void> {
    // Phase indices must be unique and contiguous from 0. Mirrors how
    // the experiment phase array works — A6 orchestrator joins CBE →
    // CB by `phase` index alone and a sparse / duplicated array would
    // silently misroute weights.
    const seen = new Set<number>();
    for (const phase of doc.phases) {
      if (seen.has(phase.phase)) {
        throw new Error(
          `Duplicate phase index in ContextualBandit: ${phase.phase}`,
        );
      }
      seen.add(phase.phase);
    }
  }

  public async getByExperimentId(
    experimentId: string,
  ): Promise<ContextualBanditInterface | null> {
    return this._findOne({ experiment: experimentId });
  }

  /**
   * Mutate a single phase's weights in-place. Used by the A6 orchestrator
   * after a successful CBE write — bumps the seed (so the next tick draws
   * a different Thompson sample) and stamps the producing CBE id so the
   * SDK payload builder can detect a stale snapshot.
   *
   * Returns the updated CB doc. Throws if no doc exists for the
   * experiment OR if the requested phase index is not present yet
   * (caller is responsible for appending phases via a normal `update()`
   * before calling here).
   */
  public async patchPhaseWeights(
    experimentId: string,
    phase: number,
    leafWeights: LeafWeight[],
    lastContextualBanditEventId: string,
    newSeed: number,
  ): Promise<ContextualBanditInterface> {
    const existing = await this.getByExperimentId(experimentId);
    if (!existing) {
      throw new Error(
        `No ContextualBandit doc found for experiment ${experimentId}`,
      );
    }
    const phaseIdx = existing.phases.findIndex((p) => p.phase === phase);
    if (phaseIdx === -1) {
      throw new Error(`ContextualBandit ${existing.id} has no phase ${phase}`);
    }
    const nextPhases = existing.phases.map((p, i) =>
      i === phaseIdx
        ? {
            ...p,
            currentLeafWeights: leafWeights,
            lastContextualBanditEventId,
            seed: newSeed,
          }
        : p,
    );
    return this.update(existing, { phases: nextPhases });
  }
}
