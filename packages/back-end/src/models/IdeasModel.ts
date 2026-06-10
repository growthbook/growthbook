import { IdeaInterface } from "shared/types/idea";
import { Vote } from "shared/types/vote";
import { ideaValidator } from "shared/validators";
import { UpdateProps } from "shared/types/base-model";
import { MakeModelClass } from "./BaseModel";

// Documents written by the legacy mongoose model can be missing fields the
// validator requires. In particular, the old vote sub-schema never persisted
// dateUpdated (it wasn't a schema path, so mongoose stripped it on save).
type LegacyIdea = Omit<
  IdeaInterface,
  "archived" | "tags" | "impactScore" | "experimentLength" | "userId" | "votes"
> & {
  archived?: boolean;
  tags?: string[];
  impactScore?: number;
  experimentLength?: number;
  userId?: string | null;
  votes?: (Omit<Vote, "dir" | "dateUpdated"> & {
    dir: number;
    dateUpdated?: Date;
  })[];
};

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

  protected migrate(legacyDoc: unknown): IdeaInterface {
    const doc = legacyDoc as LegacyIdea;
    return {
      ...doc,
      archived: doc.archived ?? false,
      tags: doc.tags ?? [],
      impactScore: doc.impactScore ?? 0,
      experimentLength: doc.experimentLength ?? 0,
      userId: doc.userId ?? null,
      votes: doc.votes?.map((v) => ({
        ...v,
        dir: v.dir > 0 ? 1 : -1,
        dateUpdated: v.dateUpdated ?? v.dateCreated,
      })),
    };
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
