import { InsightInterface, insightValidator } from "shared/validators";
import { generateEmbeddings } from "back-end/src/enterprise/services/ai";
import { logger } from "back-end/src/util/logger";
import { MakeModelClass } from "./BaseModel";

export function getInsightTextForEmbedding(
  insight: Pick<InsightInterface, "title" | "text">,
): string {
  return `Title: ${insight.title}\nText: ${insight.text}`;
}

const BaseClass = MakeModelClass({
  schema: insightValidator,
  collectionName: "insights",
  idPrefix: "insight_",
  auditLog: {
    entity: "insight",
    createEvent: "insight.create",
    updateEvent: "insight.update",
    deleteEvent: "insight.delete",
  },
  globallyUniquePrimaryKeys: true,
  defaultValues: {
    tags: [],
    authors: [],
    supportingExperimentIds: [],
    contraryEvidence: [],
    projects: [],
    status: "",
    source: "manual",
  },
});

export class InsightModel extends BaseClass {
  protected migrate(doc: unknown): InsightInterface {
    const insight = doc as InsightInterface;
    return {
      ...insight,
      // Normalize legacy null/missing status to the "" no-status sentinel
      status: insight.status ?? "",
      // Docs predating the provenance field were all human-curated
      source: insight.source ?? "manual",
    };
  }

  // Expose the update permission so API responses can tell the front-end
  // whether the requesting user may edit/delete each insight (instead of
  // the client re-implementing this logic).
  public canManageInsight(doc: InsightInterface): boolean {
    return this.canUpdate(doc);
  }

  protected canRead(doc: InsightInterface): boolean {
    return this.context.permissions.canReadMultiProjectResource(doc.projects);
  }

  protected canCreate(doc: InsightInterface): boolean {
    const projects = doc.projects && doc.projects.length ? doc.projects : [""];
    return projects.some((project) =>
      this.context.permissions.canCreateExperiment({ project }),
    );
  }

  // Only the owner or an org-settings admin can edit/delete a saved insight.
  // Everyone with read access can still comment via the discussion thread.
  protected canUpdate(doc: InsightInterface): boolean {
    if (doc.owner && doc.owner === this.context.userId) return true;
    if (this.context.superAdmin) return true;
    return this.context.permissions.canManageOrgSettings();
  }

  protected canDelete(doc: InsightInterface): boolean {
    return this.canUpdate(doc);
  }

  public async getByExperimentId(
    experimentId: string,
  ): Promise<InsightInterface[]> {
    return this._find({ supportingExperimentIds: experimentId });
  }

  // Keep an embedding of each insight in the vectors collection so the AI
  // insight finder can hard-dedup candidate insights against saved ones via
  // cosine similarity. Embedding failures are logged and swallowed — they
  // must never block saving the insight itself.
  private async upsertEmbedding(doc: InsightInterface): Promise<void> {
    if (!this.context.org.settings?.aiEnabled) return;
    try {
      const embeddings = await generateEmbeddings({
        context: this.context,
        input: [getInsightTextForEmbedding(doc)],
      });
      if (embeddings[0]?.length) {
        await this.context.models.vectors.addOrUpdateInsightVector(doc.id, {
          embeddings: embeddings[0],
        });
      }
    } catch (e) {
      logger.error(e, `Error generating embedding for insight ${doc.id}`);
    }
  }

  protected async afterCreate(doc: InsightInterface): Promise<void> {
    await this.upsertEmbedding(doc);
  }

  protected async afterUpdate(
    _existing: InsightInterface,
    updates: Partial<InsightInterface>,
    newDoc: InsightInterface,
  ): Promise<void> {
    if (updates.title !== undefined || updates.text !== undefined) {
      await this.upsertEmbedding(newDoc);
    }
  }

  protected async afterDelete(doc: InsightInterface): Promise<void> {
    try {
      await this.context.models.vectors.deleteByJoinId(doc.id, "insight");
    } catch (e) {
      logger.error(e, `Error deleting embedding for insight ${doc.id}`);
    }
  }
}
