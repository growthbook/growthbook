import { isEqual } from "lodash";
import { UpdateProps } from "shared/types/base-model";
import { SafeRolloutInterface, safeRolloutValidator } from "shared/validators";
import { getEnvironmentIdsFromOrg } from "back-end/src/services/organizations";
import { queueSDKPayloadRefresh } from "back-end/src/services/features";
import { getAffectedSDKPayloadKeys } from "back-end/src/util/features";
import { getFeature } from "back-end/src/models/FeatureModel";
import { MakeModelClass } from "./BaseModel";

export const COLLECTION_NAME = "saferollout";

const BaseClass = MakeModelClass({
  schema: safeRolloutValidator,
  collectionName: COLLECTION_NAME,
  idPrefix: "sr_",
  auditLog: {
    entity: "safeRollout",
    createEvent: "safeRollout.create",
    updateEvent: "safeRollout.update",
    deleteEvent: "safeRollout.delete",
  },
  globallyUniquePrimaryKeys: true,
  skipAuditLogFields: ["nextSnapshotAttempt", "lastSnapshotAttempt"],
  skipDateUpdatedFields: ["nextSnapshotAttempt", "lastSnapshotAttempt"],
  defaultValues: {
    autoSnapshots: true,
  },
});

export class SafeRolloutModel extends BaseClass {
  // TODO: fix permissions
  protected canRead() {
    return true;
  }
  protected canCreate() {
    return true;
  }
  protected canUpdate() {
    return true;
  }
  protected canDelete() {
    return true;
  }
  protected migrate(
    legacyDoc: Partial<SafeRolloutInterface>,
  ): SafeRolloutInterface {
    if (!("rampUpSchedule" in legacyDoc)) {
      legacyDoc["rampUpSchedule"] = {
        enabled: false,
        step: 0,
        steps: [],
        nextUpdate: undefined,
        lastUpdate: undefined,
        rampUpCompleted: false,
      };
    }
    if (!("autoRollback" in legacyDoc)) {
      legacyDoc["autoRollback"] = false;
    }
    // Environment scoping now lives on rule.environments, not the SafeRollout doc.
    delete legacyDoc["environment"];
    return legacyDoc as SafeRolloutInterface;
  }

  public async getAllByFeatureId(featureId: string) {
    return await this._find({ featureId });
  }

  /**
   * Compensation for a failed bulk publish: put a safe rollout the apply's
   * status sync advanced back to its pre-apply state. Restores ONLY the
   * fields the sync writes, each with a per-field ownership check against the
   * post-apply snapshot (`written`) — a field another writer advanced after
   * the apply is newer intent and stays. Raw write, compensation-only: the
   * validated update path can't express the start-metadata unset.
   */
  public async restoreAfterFailedBulkPublish(
    pre: SafeRolloutInterface,
    writtenStatus: string,
    written?: SafeRolloutInterface,
    // dryRun runs every check — including the deterministic missing-baseline
    // refusal — without writing, so the caller can preflight ALL of a
    // feature's rollouts before mutating any of them.
    options?: { dryRun?: boolean },
  ) {
    const live = await this.getById(pre.id);
    if (!live) return;
    if (live.status === pre.status) return;
    if (live.status !== (written?.status ?? writtenStatus)) return;
    const sameDate = (a?: Date | null, b?: Date | null) =>
      (a?.getTime() ?? null) === (b?.getTime() ?? null);
    // The sync stamps start metadata only when transitioning a never-started
    // rollout to running — the only case where those timing fields are ours to
    // reverse. Ownership of each REQUIRES the post-apply snapshot (`written`).
    const applyStartedIt =
      !pre.startedAt && writtenStatus === "running" && !!live.startedAt;
    // Apply stamped start metadata but the post-apply snapshot is missing: we
    // can't prove ownership of the timing fields, and restoring status alone
    // would leave a rolled-back rollout carrying the publish's startedAt/
    // schedule. Refuse that half-restore — throw so this rollout is left
    // running (untouched) and the caller records a reversal failure.
    if (applyStartedIt && !written) {
      throw new Error(
        `safe rollout ${pre.id}: post-apply baseline missing — cannot reverse ` +
          `start metadata; rollout left running`,
      );
    }
    if (options?.dryRun) return;
    const ownsStartedAt =
      applyStartedIt &&
      !!written &&
      sameDate(live.startedAt, written.startedAt);
    const ownsNextAttempt =
      applyStartedIt &&
      !!written &&
      sameDate(live.nextSnapshotAttempt, written.nextSnapshotAttempt);
    const ownsSchedule =
      applyStartedIt &&
      !!written &&
      isEqual(live.rampUpSchedule, written.rampUpSchedule);
    const unset: Record<string, 1> = {};
    if (ownsStartedAt) unset.startedAt = 1;
    if (ownsNextAttempt) unset.nextSnapshotAttempt = 1;
    await this._dangerousGetCollection().updateOne(
      { organization: this.context.org.id, id: pre.id },
      {
        $set: {
          status: pre.status,
          ...(ownsSchedule ? { rampUpSchedule: pre.rampUpSchedule } : {}),
          dateUpdated: new Date(),
        },
        ...(Object.keys(unset).length ? { $unset: unset } : {}),
      },
    );
  }
  public async getAllByFeatureIds(featureIds: string[]) {
    return await this._find({ featureId: { $in: featureIds } });
  }
  public async getAllPayloadSafeRollouts() {
    const safeRollouts = await this._find({});
    if (!safeRollouts || safeRollouts.length === 0) {
      return new Map();
    }
    return new Map(safeRollouts.map((r) => [r.id, r]));
  }

  protected async afterUpdate(
    existing: SafeRolloutInterface,
    updates: UpdateProps<SafeRolloutInterface>,
  ) {
    if (
      updates.rampUpSchedule &&
      existing.rampUpSchedule.step !== updates.rampUpSchedule.step
    ) {
      const feature = await getFeature(this.context, existing.featureId);
      if (!feature) return;

      const allProjectIds = (await this.context.getProjects()).map((p) => p.id);
      queueSDKPayloadRefresh({
        context: this.context,
        payloadKeys: getAffectedSDKPayloadKeys(
          [feature],
          getEnvironmentIdsFromOrg(this.context.org),
          undefined,
          allProjectIds,
        ),
        auditContext: {
          event: "step changed",
          model: "saferollout",
          id: existing.featureId,
        },
      });
    }
  }

  protected async beforeUpdate(
    existing: SafeRolloutInterface,
    updates: UpdateProps<SafeRolloutInterface>,
  ) {
    // If the Safe Rollout has already been started, we are limited on what we can update to keep the data consistent
    // If the Safe Rollout has not been started, we can update all fields
    if (existing.startedAt) {
      const allowedFieldsForUpdate = [
        "status",
        "guardrailMetricIds",
        "maxDuration",
        "autoSnapshots",
        "lastSnapshotAttempt",
        "nextSnapshotAttempt",
        "analysisSummary",
        "pastNotifications",
        "rampUpSchedule",
        "dateUpdated",
        "analysisStartedAt",
      ];

      // Check for disallowed field updates
      for (const [key, value] of Object.entries(updates)) {
        const typedKey = key as keyof SafeRolloutInterface;

        // If the field is not allowed and is being changed
        if (
          !allowedFieldsForUpdate.includes(typedKey) &&
          existing[typedKey] !== value
        ) {
          throw new Error(
            `Cannot update field '${key}' after the Safe Rollout has started.`,
          );
        }
      }
    }
  }
}
