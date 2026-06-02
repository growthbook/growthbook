import { IdeaInterface } from "shared/types/idea";
import { ideaValidator } from "shared/validators";
import { UpdateProps } from "shared/types/base-model";
import { addTags, addTagsDiff } from "back-end/src/models/TagModel";
import { MakeModelClass } from "./BaseModel";

const BaseClass = MakeModelClass({
  schema: ideaValidator,
  collectionName: "ideas",
  idPrefix: "idea_",
  globallyUniquePrimaryKeys: false,
  defaultValues: {
    archived: false,
    tags: [],
    impactScore: 0,
    experimentLength: 0,
  },
});

export class IdeasModel extends BaseClass {
  protected canRead(doc: IdeaInterface): boolean {
    return this.context.permissions.canReadSingleProjectResource(doc.project);
  }

  protected canCreate(doc: IdeaInterface): boolean {
    return this.context.permissions.canCreateIdea(doc);
  }

  protected canUpdate(
    existing: IdeaInterface,
    _updates: UpdateProps<IdeaInterface>,
    newDoc: IdeaInterface,
  ): boolean {
    return this.context.permissions.canUpdateIdea(existing, newDoc);
  }

  protected canDelete(doc: IdeaInterface): boolean {
    return this.context.permissions.canDeleteIdea(doc);
  }

  protected async afterCreate(doc: IdeaInterface) {
    if (doc.tags.length > 0) {
      await addTags(doc.organization, doc.tags);
    }
  }

  protected async afterUpdate(
    existing: IdeaInterface,
    updates: UpdateProps<IdeaInterface>,
  ) {
    if (updates.tags && updates.tags.length > 0) {
      await addTagsDiff(this.context.org.id, existing.tags || [], updates.tags);
    }
  }

  public getAllByProject(project?: string): Promise<IdeaInterface[]> {
    return this._find(project ? { project } : {});
  }

  public getBySegment(segmentId: string): Promise<IdeaInterface[]> {
    return this._find({ "estimateParams.segment": segmentId });
  }

  public getByEstimate(estimateId: string): Promise<IdeaInterface[]> {
    return this._find({ "estimateParams.estimate": estimateId });
  }

  public async getRecent(
    limit: number,
    project?: string,
  ): Promise<IdeaInterface[]> {
    // Sort by dateUpdated (with a small buffer) to account for recent edits,
    // then re-sort by dateCreated and slice — mirrors the legacy
    // `getRecentIdeas` behavior.
    const ideas = await this._find(project ? { project } : {}, {
      sort: { dateUpdated: -1 },
      limit: limit + 5,
    });

    return ideas
      .sort((a, b) => b.dateCreated.getTime() - a.dateCreated.getTime())
      .slice(0, limit);
  }

  public async removeSegmentReferences(segmentId: string): Promise<void> {
    await this._dangerousGetCollection().updateMany(
      {
        organization: this.context.org.id,
        "estimateParams.segment": segmentId,
      },
      { $unset: { "estimateParams.segment": "" } },
    );
  }
}
