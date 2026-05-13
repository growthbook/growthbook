import {
  cbsRequiresContextualBanditEventId,
  cbsRequiresError,
  ContextualBanditSnapshotInterface,
  contextualBanditSnapshotValidator,
} from "shared/validators";
import { MakeModelClass } from "./BaseModel";

const BaseClass = MakeModelClass({
  schema: contextualBanditSnapshotValidator,
  collectionName: "contextualbanditsnapshots",
  idPrefix: "cbs_",
  auditLog: {
    entity: "contextualBanditSnapshot",
    createEvent: "contextualBanditSnapshot.create",
    updateEvent: "contextualBanditSnapshot.update",
    deleteEvent: "contextualBanditSnapshot.delete",
  },
  globallyUniquePrimaryKeys: false,
  // Latest snapshot for an experiment is the hottest read path (UI poll +
  // orchestrator's "is a snapshot already running?" check). Status is part
  // of the index so the orchestrator can pick out `running` snapshots
  // without scanning historical successes.
  additionalIndexes: [
    {
      fields: {
        organization: 1,
        experiment: 1,
        status: 1,
        dateCreated: -1,
      },
    },
    { fields: { organization: 1, contextualBanditQueryId: 1 } },
  ],
});

export class ContextualBanditSnapshotModel extends BaseClass {
  // Permissioning mirrors ExperimentSnapshot — gated by the experiment
  // permission rather than a CBS-specific scope, since a CBS is just the
  // lifecycle wrapper around an experiment tick. A6 handlers will resolve
  // the experiment and call `getById` here through `dangerousGet*`
  // when the orchestrator runs as a system user.
  protected canRead(): boolean {
    return true;
  }
  protected canCreate(): boolean {
    return true;
  }
  protected canUpdate(): boolean {
    return true;
  }
  protected canDelete(): boolean {
    return true;
  }

  protected async customValidation(
    doc: ContextualBanditSnapshotInterface,
  ): Promise<void> {
    if (
      cbsRequiresContextualBanditEventId(doc) &&
      !doc.contextualBanditEventId
    ) {
      throw new Error(
        "ContextualBanditSnapshot with status=success must set contextualBanditEventId",
      );
    }
    if (cbsRequiresError(doc) && !doc.error) {
      throw new Error(
        "ContextualBanditSnapshot with status=error must include a non-empty error",
      );
    }
    if (doc.status === "running" && doc.contextualBanditEventId) {
      throw new Error(
        "ContextualBanditSnapshot with status=running must not have contextualBanditEventId",
      );
    }
  }

  public async getLatestForExperiment(
    experimentId: string,
    { withResultsOnly = false }: { withResultsOnly?: boolean } = {},
  ): Promise<ContextualBanditSnapshotInterface | null> {
    const filter: Record<string, unknown> = { experiment: experimentId };
    if (withResultsOnly) {
      filter.status = "success";
    }
    const docs = await this._find(filter, {
      sort: { dateCreated: -1 },
      limit: 1,
    });
    return docs[0] ?? null;
  }

  public async getRunningSnapshotForExperiment(
    experimentId: string,
  ): Promise<ContextualBanditSnapshotInterface | null> {
    const docs = await this._find(
      { experiment: experimentId, status: "running" },
      { sort: { dateCreated: -1 }, limit: 1 },
    );
    return docs[0] ?? null;
  }

  public async listForExperiment(
    experimentId: string,
    { limit = 100 }: { limit?: number } = {},
  ): Promise<ContextualBanditSnapshotInterface[]> {
    return this._find(
      { experiment: experimentId },
      { sort: { dateCreated: -1 }, limit },
    );
  }
}
