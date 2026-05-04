import {
  ApiContextualBanditEvent,
  CONTEXTUAL_BANDIT_EVENT_CELL_CAP,
  ContextualBanditEventInterface,
  contextualBanditEventValidator,
} from "shared/validators";
import { contextualBanditEventApiSpec } from "back-end/src/api/specs/contextual-bandit-event.spec";
import { MakeModelClass } from "./BaseModel";

const BaseClass = MakeModelClass({
  schema: contextualBanditEventValidator,
  collectionName: "contextualbanditevents",
  idPrefix: "cbe_",
  auditLog: {
    entity: "contextualBanditEvent",
    createEvent: "contextualBanditEvent.create",
    updateEvent: "contextualBanditEvent.create",
    deleteEvent: "contextualBanditEvent.create",
    omitDetails: true,
  },
  globallyUniquePrimaryKeys: false,
  additionalIndexes: [
    {
      fields: { organization: 1, experiment: 1, phase: 1, date: -1 },
    },
    {
      fields: { snapshotId: 1 },
    },
  ],
  defaultValues: {
    weightsWereUpdated: false,
    reweight: false,
  },
  apiConfig: {
    modelKey: "contextualBanditEvents",
    openApiSpec: contextualBanditEventApiSpec,
  },
});

export class ContextualBanditEventModel extends BaseClass {
  protected canRead(): boolean {
    return true;
  }
  protected canCreate(): boolean {
    return true;
  }
  protected canUpdate(): boolean {
    return false;
  }
  protected canDelete(): boolean {
    return false;
  }

  protected hasPremiumFeature(): boolean {
    return this.context.hasPremiumFeature("contextual-bandits");
  }

  protected async customValidation(doc: ContextualBanditEventInterface) {
    const variationCount = doc.tree.leaves[0]?.weights.length ?? 0;
    if (variationCount > 0) {
      const cells = doc.contextResults.length * variationCount;
      if (cells > CONTEXTUAL_BANDIT_EVENT_CELL_CAP) {
        throw new Error(
          `Too many context-variation cells in event (${cells} > ${CONTEXTUAL_BANDIT_EVENT_CELL_CAP}). ` +
            `Reduce maxContexts on the experiment or trim least-populated contexts to "other".`,
        );
      }
    }
  }

  /** Latest event for an experiment phase. */
  public async getLatestForExperiment(
    experimentId: string,
    phase: number,
  ): Promise<ContextualBanditEventInterface | null> {
    const docs = await this._find(
      { experiment: experimentId, phase },
      { sort: { date: -1 }, limit: 1 },
    );
    return docs[0] ?? null;
  }

  /** Paginated list newest-first for an experiment, with cursor support. */
  public async listForExperiment(
    experimentId: string,
    {
      cursor,
      limit = 25,
    }: { cursor?: string; limit?: number } = {},
  ): Promise<{
    events: ContextualBanditEventInterface[];
    nextCursor: string | null;
    hasMore: boolean;
  }> {
    const query: Record<string, unknown> = { experiment: experimentId };
    if (cursor) {
      const cursorDate = new Date(cursor);
      if (!Number.isNaN(cursorDate.getTime())) {
        query.date = { $lt: cursorDate };
      }
    }
    const fetched = await this._find(query, {
      sort: { date: -1 },
      limit: limit + 1,
    });
    const hasMore = fetched.length > limit;
    const events = hasMore ? fetched.slice(0, limit) : fetched;
    const last = events[events.length - 1];
    const nextCursor =
      hasMore && last ? last.date.toISOString() : null;
    return { events, nextCursor, hasMore };
  }

  /** History of one context across CBEs for an experiment. */
  public async listForContext(
    experimentId: string,
    contextId: string,
  ): Promise<
    {
      eventId: string;
      date: Date;
      weights: number[];
      leafId: string;
    }[]
  > {
    const docs = await this._find(
      { experiment: experimentId, "contextResults.contextId": contextId },
      { sort: { date: -1 } },
    );
    return docs
      .map((doc) => {
        const ctx = doc.contextResults.find(
          (c) => c.contextId === contextId,
        );
        if (!ctx) return null;
        return {
          eventId: doc.id,
          date: doc.date,
          weights: ctx.weights,
          leafId: ctx.leafId,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
  }

  protected toApiInterface(
    doc: ContextualBanditEventInterface,
  ): ApiContextualBanditEvent {
    return {
      id: doc.id,
      experimentId: doc.experiment,
      phase: doc.phase,
      snapshotId: doc.snapshotId,
      cbaqId: doc.cbaqId,
      date: doc.date.toISOString(),
      contextResults: doc.contextResults,
      tree: doc.tree,
      updateMessage: doc.updateMessage,
      error: doc.error,
      weightsWereUpdated: doc.weightsWereUpdated,
      reweight: doc.reweight,
      seed: doc.seed,
      dateCreated: doc.dateCreated.toISOString(),
      dateUpdated: doc.dateUpdated.toISOString(),
    };
  }

  /**
   * Public, controlled access to the API serializer — needed for the
   * experiment-scoped contextual bandit routes which live outside the
   * model class but must emit the canonical API shape.
   */
  public toApi(doc: ContextualBanditEventInterface): ApiContextualBanditEvent {
    return this.toApiInterface(doc);
  }
}
