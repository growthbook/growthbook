import isEqual from "lodash/isEqual";
import {
  InterleavingInterface,
  interleavingValidator,
} from "shared/validators";
import { parseInterleavingRankerConfig } from "shared/util";
import { interleavingEnvsForChange } from "shared/permissions";
import { isFactMetricId } from "shared/experiments";
import { MakeModelClass } from "back-end/src/models/BaseModel";
import { validateChangedRuleReferences } from "back-end/src/api/features/validations";
import { assertValidExperimentPrerequisites } from "back-end/src/services/prerequisiteParents";
import { assertRegisteredAttributes } from "back-end/src/services/attributes";

const BaseClass = MakeModelClass({
  schema: interleavingValidator,
  collectionName: "interleavings",
  idPrefix: "il_",
  globallyUniquePrimaryKeys: true,
  defaultValues: {
    owner: "",
    tags: [],
    archived: false,
    metrics: [],
    jsonSchema: null,
    environmentSettings: {},
  },
  auditLog: {
    entity: "interleaving",
    createEvent: "interleaving.create",
    updateEvent: "interleaving.update",
    deleteEvent: "interleaving.delete",
  },
  additionalIndexes: [
    {
      fields: {
        organization: 1,
        trackingKey: 1,
      },
    },
  ],
  // TODO(interleaving): apiConfig + interleaving.spec.ts when the REST API
  // lands (after the SDK work), following ContextualBanditModel.
});

export class InterleavingModel extends BaseClass {
  protected hasPremiumFeature(): boolean {
    return this.context.hasPremiumFeature("interleaving");
  }

  protected async customValidation(
    doc: InterleavingInterface,
    previousDoc?: InterleavingInterface,
  ): Promise<void> {
    // The tracking key is the pseudo flag key (`$interleave:<trackingKey>`)
    // and the exposures' experiment_id, so it must be unique in the org.
    if (doc.trackingKey !== previousDoc?.trackingKey) {
      if (!doc.trackingKey.trim()) {
        throw new Error("Interleaving tracking key cannot be empty.");
      }
      const clash = await this._findOne({ trackingKey: doc.trackingKey });
      if (clash && clash.id !== doc.id) {
        throw new Error(
          `Another interleaving experiment already uses the tracking key "${doc.trackingKey}".`,
        );
      }
    }

    if (
      !previousDoc ||
      !isEqual(doc.variations, previousDoc.variations) ||
      !isEqual(doc.jsonSchema, previousDoc.jsonSchema)
    ) {
      const [a, b] = doc.variations;
      if (a.key === b.key) {
        throw new Error("The two rankers must have different keys.");
      }
      if (a.id === b.id) {
        throw new Error("The two rankers must have different ids.");
      }
      for (const v of doc.variations) {
        try {
          parseInterleavingRankerConfig(v.config, doc.jsonSchema);
        } catch (e) {
          throw new Error(
            `Ranker "${v.name || v.key}": ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }
    }

    // Only re-validate metrics when they (or the datasource) change, so an
    // experiment whose metric was deleted later can still be edited.
    if (
      !previousDoc ||
      !isEqual(doc.metrics, previousDoc.metrics) ||
      doc.datasource !== previousDoc.datasource
    ) {
      const ids = doc.metrics.map((m) => m.id);
      if (new Set(ids).size !== ids.length) {
        throw new Error("Each metric can only be added once.");
      }
      for (const { id } of doc.metrics) {
        if (!isFactMetricId(id)) {
          throw new Error(`Interleaving metrics must be fact metrics: ${id}`);
        }
        const metric = await this.context.models.factMetrics.getById(id);
        if (!metric) {
          throw new Error(`Interleaving metric not found: ${id}`);
        }
        if (metric.datasource !== doc.datasource) {
          throw new Error(
            `Interleaving metric ${id} must belong to datasource ${doc.datasource}`,
          );
        }
        if (
          metric.metricType !== "mean" &&
          metric.metricType !== "proportion"
        ) {
          throw new Error(
            `Interleaving metrics must be mean or proportion metrics: ${id} is a ${metric.metricType} metric`,
          );
        }
      }
    }

    if (
      !previousDoc ||
      !isEqual(
        Object.keys(doc.environmentSettings).sort(),
        Object.keys(previousDoc.environmentSettings).sort(),
      )
    ) {
      const orgEnvs = new Set(
        (this.context.org.settings?.environments ?? []).map((e) => e.id),
      );
      const unknown = Object.keys(doc.environmentSettings).filter(
        (env) => !orgEnvs.has(env),
      );
      if (unknown.length) {
        throw new Error(`Unknown environments: ${unknown.join(", ")}`);
      }
    }

    // Targeting reaches the SDK payload as the pseudo flag's rule, so it gets
    // the feature-rule write checks (changed fields only), as CBs do.
    await validateChangedRuleReferences(
      [doc],
      previousDoc ? [previousDoc] : [],
      this.context,
    );
    await assertValidExperimentPrerequisites(
      this.context,
      doc.prerequisites,
      previousDoc?.prerequisites,
    );
    assertRegisteredAttributes(
      this.context,
      { hashAttribute: doc.hashAttribute, condition: doc.condition },
      "interleaving experiment",
      previousDoc && {
        hashAttribute: previousDoc.hashAttribute,
        condition: previousDoc.condition,
      },
      doc.project || undefined,
    );
  }

  protected canRead(doc: InterleavingInterface): boolean {
    return this.context.permissions.canReadSingleProjectResource(doc.project);
  }

  protected canCreate(doc: InterleavingInterface): boolean {
    const envs = interleavingEnvsForChange({
      existing: doc,
      environmentIds: this.context.environments,
    });
    if (
      envs.length > 0 &&
      !this.context.permissions.canRunInterleaving(doc, envs)
    ) {
      return false;
    }
    return this.context.permissions.canCreateInterleaving(doc);
  }

  protected canUpdate(
    existing: InterleavingInterface,
    updated?: Partial<InterleavingInterface>,
  ): boolean {
    const statusChanged =
      updated?.status !== undefined && updated.status !== existing.status;
    const envsChanged =
      updated?.environmentSettings !== undefined &&
      !isEqual(updated.environmentSettings, existing.environmentSettings);
    const envs = interleavingEnvsForChange({
      existing,
      updated,
      environmentIds: this.context.environments,
    });
    if (
      (statusChanged || envsChanged) &&
      envs.length > 0 &&
      !this.context.permissions.canRunInterleaving(existing, envs)
    ) {
      return false;
    }
    return this.context.permissions.canUpdateInterleaving(
      existing,
      updated ?? existing,
    );
  }

  protected canDelete(doc: InterleavingInterface): boolean {
    return this.context.permissions.canDeleteInterleaving(doc);
  }

  /** All interleaving experiments that read from a given Interleaving Query. */
  public getByInterleavingQueryId(
    interleavingQueryId: string,
  ): Promise<InterleavingInterface[]> {
    return this._find({ interleavingQueryId });
  }

  public getByTrackingKey(
    trackingKey: string,
  ): Promise<InterleavingInterface | null> {
    return this._findOne({ trackingKey });
  }
}
