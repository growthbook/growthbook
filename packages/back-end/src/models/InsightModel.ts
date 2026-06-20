import { CreateProps } from "shared/types/base-model";
import {
  ApiInsight,
  ApiSearchInsightResult,
  InsightInterface,
  apiCreateInsightBody,
  insightValidator,
} from "shared/validators";
import { DEFAULT_LEARNING_STATUSES } from "shared/constants";
import {
  cosineSimilarity,
  generateEmbeddings,
} from "back-end/src/enterprise/services/ai";
import { assertAIAccess } from "back-end/src/enterprise/services/ai-access";
import { logger } from "back-end/src/util/logger";
import { defineCustomApiHandler } from "back-end/src/api/apiModelHandlers";
import { resolveOwnerEmails } from "back-end/src/services/owner";
import {
  insightApiSpec,
  searchInsightsEndpoint,
} from "back-end/src/api/specs/insight.spec";
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
  apiConfig: {
    modelKey: "insights",
    openApiSpec: insightApiSpec,
    customHandlers: [
      defineCustomApiHandler({
        ...searchInsightsEndpoint,
        reqHandler: async (
          req,
        ): Promise<{ insights: ApiSearchInsightResult[] }> => {
          const model = req.context.models.insights;
          const ranked = await model.searchByQuery({
            query: req.body.query,
            limit: req.body.limit,
            projectId: req.body.projectId,
          });
          const apiDocs = await resolveOwnerEmails(
            ranked.map((r) => model.toApiInterface(r.insight)),
            req.context,
          );
          return {
            insights: apiDocs.map((doc, i) => ({
              ...doc,
              similarity: ranked[i].similarity,
            })),
          };
        },
      }),
    ],
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

  // Validate the learning status against the org's configured list on create
  // and whenever it changes. Runs for both internal and external API paths.
  protected async customValidation(
    doc: InsightInterface,
    existing?: InsightInterface,
  ): Promise<void> {
    if (!doc.status) return;
    if (existing && existing.status === doc.status) return;
    const learningStatuses =
      this.context.org.settings?.learningStatuses ?? DEFAULT_LEARNING_STATUSES;
    if (!learningStatuses.some((s) => s.id === doc.status)) {
      throw new Error(
        `Unknown learning status "${doc.status}". Configure statuses under Settings → General → Experiment Settings.`,
      );
    }
  }

  public async getByExperimentId(
    experimentId: string,
  ): Promise<InsightInterface[]> {
    return this._find({ supportingExperimentIds: experimentId });
  }

  // --- External REST API ---

  public toApiInterface(doc: InsightInterface): ApiInsight {
    return {
      id: doc.id,
      dateCreated: doc.dateCreated.toISOString(),
      dateUpdated: doc.dateUpdated.toISOString(),
      owner: doc.owner || "",
      authors: doc.authors || [],
      title: doc.title,
      text: doc.text,
      tags: doc.tags || [],
      supportingExperimentIds: doc.supportingExperimentIds || [],
      contraryEvidence: doc.contraryEvidence || [],
      projects: doc.projects || [],
      status: doc.status || "",
      source: doc.source || "manual",
    };
  }

  // Shape the external create body into internal create props. Provenance is
  // forced to "api" (the client can't set it), and authorship is attributed
  // to the PAT user when the request is made with a personal access token.
  protected async processApiCreateBody(
    rawBody: unknown,
  ): Promise<CreateProps<InsightInterface>> {
    const body = apiCreateInsightBody.parse(rawBody);
    return {
      title: body.title,
      text: body.text ?? "",
      tags: body.tags ?? [],
      supportingExperimentIds: body.supportingExperimentIds ?? [],
      contraryEvidence: body.contraryEvidence ?? [],
      projects: body.projects ?? [],
      status: body.status ?? "",
      owner: body.owner,
      authors: this.context.userId ? [this.context.userId] : [],
      source: "api",
    } as CreateProps<InsightInterface>;
  }

  public override async handleApiList(
    req: Parameters<InstanceType<typeof BaseClass>["handleApiList"]>[0],
  ): Promise<ApiInsight[]> {
    const { projectId, experimentId, tag, status } = req.query;

    const base = experimentId
      ? await this.getByExperimentId(experimentId)
      : await this.getAll();

    const filtered = base.filter((i) => {
      if (projectId && i.projects?.length && !i.projects.includes(projectId)) {
        return false;
      }
      if (tag && !(i.tags || []).includes(tag)) return false;
      if (status !== undefined && (i.status || "") !== status) return false;
      return true;
    });

    return resolveOwnerEmails(
      filtered.map((doc) => this.toApiInterface(doc)),
      this.context,
    );
  }

  // Embedding-ranked search over saved insights. Returns the insights the
  // caller can read, ordered by cosine similarity to the query.
  public async searchByQuery({
    query,
    limit = 10,
    projectId,
  }: {
    query: string;
    limit?: number;
    projectId?: string;
  }): Promise<{ insight: InsightInterface; similarity: number }[]> {
    // Enforce the same premium, AI-enabled, and rate-limit gates as the find
    // flow — otherwise external search could keep spending embeddings after
    // the org is throttled.
    await assertAIAccess(this.context);

    const candidates = (await this.getAll()).filter(
      (i) =>
        !projectId || !i.projects?.length || i.projects.includes(projectId),
    );
    if (!candidates.length) return [];

    const [queryEmbedding] = await generateEmbeddings({
      context: this.context,
      input: [query],
    });
    if (!queryEmbedding?.length) return [];

    const vectors = await this.context.models.vectors.getByInsightIds(
      candidates.map((i) => i.id),
    );
    const embeddingById = new Map(vectors.map((v) => [v.joinId, v.embeddings]));

    return candidates
      .map((insight) => {
        const embedding = embeddingById.get(insight.id);
        const similarity =
          embedding && embedding.length === queryEmbedding.length
            ? cosineSimilarity(queryEmbedding, embedding)
            : -1; // missing/mismatched embedding sinks to the bottom
        return { insight, similarity };
      })
      .filter((r) => r.similarity >= 0)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);
  }

  // Maintain an embedding per insight (in the vectors collection) so the AI
  // finder and search can rank/dedup by cosine similarity. Best-effort: a
  // failure here must never block saving the insight.
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
