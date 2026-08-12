import { CreateProps } from "shared/types/base-model";
import {
  ApiLearning,
  ApiSearchLearningResult,
  LearningInterface,
  apiCreateLearningBody,
  learningValidator,
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
  learningApiSpec,
  searchLearningsEndpoint,
} from "back-end/src/api/specs/learning.spec";
import { MakeModelClass } from "./BaseModel";

export function getLearningTextForEmbedding(
  learning: Pick<LearningInterface, "title" | "text">,
): string {
  return `Title: ${learning.title}\nText: ${learning.text}`;
}

const BaseClass = MakeModelClass({
  schema: learningValidator,
  collectionName: "learnings",
  idPrefix: "lrn_",
  auditLog: {
    entity: "learning",
    createEvent: "learning.create",
    updateEvent: "learning.update",
    deleteEvent: "learning.delete",
  },
  globallyUniquePrimaryKeys: true,
  defaultValues: {
    tags: [],
    authors: [],
    supportingExperimentIds: [],
    contradictingExperimentIds: [],
    projects: [],
    status: "",
    source: "manual",
  },
  apiConfig: {
    modelKey: "learnings",
    openApiSpec: learningApiSpec,
    customHandlers: [
      defineCustomApiHandler({
        ...searchLearningsEndpoint,
        reqHandler: async (
          req,
        ): Promise<{ learnings: ApiSearchLearningResult[] }> => {
          const model = req.context.models.learnings;
          const ranked = await model.searchByQuery({
            query: req.body.query,
            limit: req.body.limit,
            projectId: req.body.projectId,
          });
          const apiDocs = await resolveOwnerEmails(
            ranked.map((r) => model.toApiInterface(r.learning)),
            req.context,
          );
          return {
            learnings: apiDocs.map((doc, i) => ({
              ...doc,
              similarity: ranked[i].similarity,
            })),
          };
        },
      }),
    ],
  },
});

export class LearningModel extends BaseClass {
  // Expose the update permission so API responses can tell the front-end
  // whether the requesting user may edit/delete each learning (instead of
  // the client re-implementing this logic).
  public canManageLearning(doc: LearningInterface): boolean {
    // No project change — just "can this user edit it as it stands".
    return this.canUpdate(doc, {});
  }

  // Enterprise-only. BaseModel enforces this on create/update; reads stay
  // available so an org that downgrades can still see what it captured.
  protected hasPremiumFeature(): boolean {
    return this.context.hasPremiumFeature("learnings");
  }

  protected canRead(doc: LearningInterface): boolean {
    return this.context.permissions.canReadMultiProjectResource(doc.projects);
  }

  protected canCreate(doc: LearningInterface): boolean {
    return this.context.permissions.canCreateLearning(doc);
  }

  protected canUpdate(
    existing: LearningInterface,
    updates: Partial<LearningInterface>,
  ): boolean {
    return this.context.permissions.canUpdateLearning(existing, {
      projects: updates.projects ?? existing.projects,
    });
  }

  protected canDelete(doc: LearningInterface): boolean {
    return this.context.permissions.canDeleteLearning(doc);
  }

  // Validate the learning status against the org's configured list on create
  // and whenever it changes. Runs for both internal and external API paths.
  protected async customValidation(
    doc: LearningInterface,
    existing?: LearningInterface,
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

  // Learnings that reference this experiment in either direction. A
  // contradicting reference still means the Learning is about that
  // experiment, and is often the more interesting one to surface.
  public async getByExperimentId(
    experimentId: string,
  ): Promise<LearningInterface[]> {
    return this._find({
      $or: [
        { supportingExperimentIds: experimentId },
        { contradictingExperimentIds: experimentId },
      ],
    });
  }

  // --- External REST API ---

  public toApiInterface(doc: LearningInterface): ApiLearning {
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
      contradictingExperimentIds: doc.contradictingExperimentIds || [],
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
  ): Promise<CreateProps<LearningInterface>> {
    const body = apiCreateLearningBody.parse(rawBody);
    return {
      title: body.title,
      text: body.text ?? "",
      tags: body.tags ?? [],
      supportingExperimentIds: body.supportingExperimentIds ?? [],
      contradictingExperimentIds: body.contradictingExperimentIds ?? [],
      projects: body.projects ?? [],
      status: body.status ?? "",
      owner: body.owner,
      authors: this.context.userId ? [this.context.userId] : [],
      source: "api",
    } as CreateProps<LearningInterface>;
  }

  public override async handleApiList(
    req: Parameters<InstanceType<typeof BaseClass>["handleApiList"]>[0],
  ): Promise<ApiLearning[]> {
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

  // Embedding-ranked search over saved learnings. Returns the learnings the
  // caller can read, ordered by cosine similarity to the query.
  public async searchByQuery({
    query,
    limit = 10,
    projectId,
  }: {
    query: string;
    limit?: number;
    projectId?: string;
  }): Promise<{ learning: LearningInterface; similarity: number }[]> {
    if (!this.context.hasPremiumFeature("learnings")) {
      this.context.throwPlanDoesNotAllowError(
        "Learnings requires an Enterprise plan.",
      );
    }
    // Enforce the same premium, AI-enabled, and rate-limit gates as the find
    // flow — otherwise external search could keep spending embeddings after
    // the org is throttled. Metered against the embedding provider: a BYOK key
    // for the org's text model doesn't pay for managed embeddings.
    await assertAIAccess(this.context, { embeddings: true });

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

    const vectors = await this.context.models.vectors.getByLearningIds(
      candidates.map((i) => i.id),
    );
    const embeddingById = new Map(vectors.map((v) => [v.joinId, v.embeddings]));

    return candidates
      .map((learning) => {
        const embedding = embeddingById.get(learning.id);
        const similarity =
          embedding && embedding.length === queryEmbedding.length
            ? cosineSimilarity(queryEmbedding, embedding)
            : -1; // missing/mismatched embedding sinks to the bottom
        return { learning, similarity };
      })
      .filter((r) => r.similarity >= 0)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);
  }

  // Maintain an embedding per learning (in the vectors collection) so the AI
  // finder and search can rank/dedup by cosine similarity. Best-effort: a
  // failure here must never block saving the learning.
  private async upsertEmbedding(doc: LearningInterface): Promise<void> {
    if (!this.context.org.settings?.aiEnabled) return;
    try {
      const embeddings = await generateEmbeddings({
        context: this.context,
        input: [getLearningTextForEmbedding(doc)],
      });
      if (embeddings[0]?.length) {
        await this.context.models.vectors.addOrUpdateLearningVector(doc.id, {
          embeddings: embeddings[0],
        });
      }
    } catch (e) {
      logger.error(e, `Error generating embedding for learning ${doc.id}`);
    }
  }

  protected async afterCreate(doc: LearningInterface): Promise<void> {
    await this.upsertEmbedding(doc);
  }

  protected async afterUpdate(
    _existing: LearningInterface,
    updates: Partial<LearningInterface>,
    newDoc: LearningInterface,
  ): Promise<void> {
    if (updates.title !== undefined || updates.text !== undefined) {
      await this.upsertEmbedding(newDoc);
    }
  }

  protected async afterDelete(doc: LearningInterface): Promise<void> {
    try {
      await this.context.models.vectors.deleteByJoinId(doc.id, "learning");
    } catch (e) {
      logger.error(e, `Error deleting embedding for learning ${doc.id}`);
    }
  }
}
