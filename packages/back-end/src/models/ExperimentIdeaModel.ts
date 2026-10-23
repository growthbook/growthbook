import {
  ExperimentIdeaInterface,
  experimentIdeaValidator,
} from "shared/validators";
import { getExperimentIdeaStages } from "shared/experiment-ideas";
import { validateCustomFieldsForSection } from "back-end/src/util/custom-fields";
import { MakeModelClass } from "./BaseModel";

const BaseClass = MakeModelClass({
  schema: experimentIdeaValidator,
  collectionName: "experimentideas",
  idPrefix: "ide_",
  auditLog: {
    entity: "experimentIdea",
    createEvent: "experimentIdea.create",
    updateEvent: "experimentIdea.update",
    deleteEvent: "experimentIdea.delete",
  },
  globallyUniquePrimaryKeys: true,
  readonlyFields: ["createdBy", "source"],
  // A vote is an interest signal, not an edit; it must not reorder
  // "recently updated" or flood the audit log.
  skipDateUpdatedFields: ["upvotes"],
  skipAuditLogFields: ["upvotes"],
  defaultValues: {
    project: "",
    description: "",
    hypothesis: "",
    expectedOutcome: "",
    rationale: "",
    productArea: "",
    owner: "",
    authors: [],
    tags: [],
    metricIds: [],
    goalMetricId: "",
    analyticsDashboardId: "",
    powerCheck: null,
    archived: false,
    dateArchived: null,
    archivedBy: null,
    upvotes: [],
    source: "manual",
    informedBy: [],
    customFields: {},
  },
  additionalIndexes: [
    { fields: { organization: 1, dateUpdated: -1 } },
    { fields: { organization: 1, archived: 1, stage: 1, dateUpdated: -1 } },
    { fields: { organization: 1, project: 1, archived: 1, dateUpdated: -1 } },
    { fields: { organization: 1, owner: 1, archived: 1 } },
    { fields: { organization: 1, tags: 1 } },
    { fields: { organization: 1, metricIds: 1 } },
    { fields: { organization: 1, "informedBy.id": 1 } },
    { fields: { organization: 1, upvotes: 1 } },
  ],
});

export class ExperimentIdeaModel extends BaseClass {
  public canManageIdea(doc: ExperimentIdeaInterface): boolean {
    return this.canUpdate(doc, {});
  }

  protected canRead(doc: ExperimentIdeaInterface): boolean {
    return this.context.permissions.canReadSingleProjectResource(doc.project);
  }

  protected canCreate(doc: ExperimentIdeaInterface): boolean {
    return this.context.permissions.canManageExperimentIdea(doc);
  }

  protected canUpdate(
    existing: ExperimentIdeaInterface,
    updates: Partial<ExperimentIdeaInterface>,
  ): boolean {
    return this.context.permissions.canUpdateExperimentIdea(existing, {
      project: updates.project,
    });
  }

  protected canDelete(doc: ExperimentIdeaInterface): boolean {
    return this.context.permissions.canManageExperimentIdea(doc);
  }

  protected async customValidation(
    doc: ExperimentIdeaInterface,
    existing?: ExperimentIdeaInterface,
  ): Promise<void> {
    if (!doc.title.trim()) {
      throw new Error("Title is required");
    }

    // A stage deleted from settings stays valid on ideas that already hold it.
    if (!existing || existing.stage !== doc.stage) {
      const { stages } = getExperimentIdeaStages(this.context.org.settings);
      if (!stages.some((s) => s.id === doc.stage)) {
        throw new Error(`Unknown Experiment Idea stage "${doc.stage}"`);
      }
    }

    if (doc.project && (!existing || existing.project !== doc.project)) {
      const project = await this.context.models.projects.getById(doc.project);
      if (!project) throw new Error("Project not found");
    }

    if (
      !existing ||
      existing.project !== doc.project ||
      JSON.stringify(existing.customFields) !== JSON.stringify(doc.customFields)
    ) {
      await validateCustomFieldsForSection({
        customFieldValues: doc.customFields,
        existingCustomFieldValues: existing?.customFields,
        customFieldsModel: this.context.models.customFields,
        section: "experiment-idea",
        project: doc.project || undefined,
      });
    }
  }

  public async getAllIdeas({
    includeArchived,
  }: {
    includeArchived: boolean;
  }): Promise<ExperimentIdeaInterface[]> {
    return this._find(includeArchived ? {} : { archived: false }, {
      sort: { dateUpdated: -1 },
    });
  }

  public async countByStage(stageIds: string[]): Promise<number> {
    return this._countDocuments({ stage: { $in: stageIds } });
  }

  // Atomic and idempotent so concurrent votes never clobber each other.
  public async setUpvote(
    idea: ExperimentIdeaInterface,
    userId: string,
    upvoted: boolean,
  ): Promise<void> {
    const filter = { organization: this.context.org.id, id: idea.id };
    if (upvoted) {
      await this._dangerousGetCollection().updateOne(filter, {
        $addToSet: { upvotes: userId },
      });
    } else {
      await this._dangerousGetCollection().updateOne(filter, {
        $pull: { upvotes: userId },
      });
    }
  }
}
