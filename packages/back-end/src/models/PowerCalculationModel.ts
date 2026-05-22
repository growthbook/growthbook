import { isEqual } from "lodash";
import {
  PowerCalculationInterface,
  powerCalculationValidator,
} from "shared/validators";
import { powerMetricWeeks } from "shared/power";
import { UpdateProps } from "shared/types/base-model";
import { logger } from "back-end/src/util/logger";
import { ExperimentModel } from "back-end/src/models/ExperimentModel";
import { MakeModelClass } from "./BaseModel";

const BaseClass = MakeModelClass({
  schema: powerCalculationValidator,
  collectionName: "powercalculations",
  idPrefix: "pwr_",
  auditLog: {
    entity: "powerCalculation",
    createEvent: "powerCalculation.create",
    updateEvent: "powerCalculation.update",
    deleteEvent: "powerCalculation.delete",
  },
  globallyUniquePrimaryKeys: false,
});

export class PowerCalculationModel extends BaseClass {
  protected canRead(doc: PowerCalculationInterface): boolean {
    return this.context.permissions.canReadSingleProjectResource(doc.project);
  }

  protected canCreate(doc: PowerCalculationInterface): boolean {
    return this.context.permissions.canCreatePowerCalculation({
      project: doc.project,
    });
  }

  protected canUpdate(
    existing: PowerCalculationInterface,
    _updates: UpdateProps<PowerCalculationInterface>,
    newDoc: PowerCalculationInterface,
  ): boolean {
    return this.context.permissions.canUpdatePowerCalculation(
      { project: existing.project },
      { project: newDoc.project },
    );
  }

  protected canDelete(doc: PowerCalculationInterface): boolean {
    return this.context.permissions.canDeletePowerCalculation({
      project: doc.project,
    });
  }

  // `results` is server-computed. Populate it before the document is inserted.
  protected async beforeCreate(doc: PowerCalculationInterface): Promise<void> {
    doc.results = {
      data: powerMetricWeeks(doc.inputs),
      computedAt: new Date(),
    };
  }

  /**
   * `beforeUpdate` runs AFTER BaseModel has built the `$set` payload from
   * `updates`, so mutating `updates` here would NOT persist. Recomputation of
   * `results` is therefore handled by overriding `update` / `updateById` below
   * to inject the new `results` into `updates` before delegating to the base
   * implementation.
   */

  // Override `update` so we can inject a recomputed `results` into `updates`
  // whenever `inputs` is changing. Delegating to the base call preserves all of
  // BaseModel's validation, permission checks, audit logging, and date handling.
  public override update(
    existing: PowerCalculationInterface,
    updates: UpdateProps<PowerCalculationInterface>,
  ): Promise<PowerCalculationInterface> {
    const merged = this.withRecomputedResults(existing, updates);
    return super.update(existing, merged);
  }

  public override async updateById(
    id: string,
    updates: UpdateProps<PowerCalculationInterface>,
  ): Promise<PowerCalculationInterface> {
    const existing = await this.getById(id);
    if (!existing) {
      throw new Error("Could not find power calculation to update");
    }
    const merged = this.withRecomputedResults(existing, updates);
    return super.update(existing, merged);
  }

  private withRecomputedResults(
    existing: PowerCalculationInterface,
    updates: UpdateProps<PowerCalculationInterface>,
  ): UpdateProps<PowerCalculationInterface> {
    if (!("inputs" in updates) || updates.inputs === undefined) {
      return updates;
    }
    if (isEqual(updates.inputs, existing.inputs)) {
      return updates;
    }
    return {
      ...updates,
      results: {
        data: powerMetricWeeks(updates.inputs),
        computedAt: new Date(),
      },
    };
  }

  // When a power calculation is deleted, null out the back-pointer on any
  // experiment that referenced it. Failures here are logged but not rethrown:
  // deletion has already succeeded and we don't want to leave the system in
  // an inconsistent state where the doc is gone but the call also threw.
  protected async afterDelete(doc: PowerCalculationInterface): Promise<void> {
    try {
      await ExperimentModel.updateMany(
        { organization: this.context.org.id, powerCalculationId: doc.id },
        { $unset: { powerCalculationId: "" } },
      );
    } catch (err) {
      logger.error(
        { err, powerCalculationId: doc.id, organization: this.context.org.id },
        "Failed to clear powerCalculationId on experiments after delete",
      );
    }
  }
}
