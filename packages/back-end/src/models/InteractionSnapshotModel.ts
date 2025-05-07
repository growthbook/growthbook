import { ReqContext } from "back-end/types/organization";
import { MakeModelClass } from "./BaseModel";
import { interactionSnapshotInterfaceValidator } from "back-end/src/validators/interactionSnapshot";
import { InteractionSnapshotInterface } from "back-end/types/interaction-snapshot";

const InteractionSnapshotClass = MakeModelClass({
  schema: interactionSnapshotInterfaceValidator,
  collectionName: "interactionSnapshots",
  idPrefix: "intsnap_",
  auditLog: {
    entity: "interactionSnapshot",
    createEvent: "interactionSnapshot.create",
    updateEvent: "interactionSnapshot.update",
    deleteEvent: "interactionSnapshot.delete",
  },
  globallyUniqueIds: false,
  additionalIndexes: [
    {
      fields: {
        organization: 1,
        dateCreated: -1,
      },
    },
  ],
});

export class InteractionSnapshotModel extends InteractionSnapshotClass {
  protected getForeignKeys(
    doc: InteractionSnapshotInterface
  ): { datasource?: string } {
    return {
      datasource: doc.datasourceId,
    };
  }

  protected canRead(doc: InteractionSnapshotInterface): boolean {
    // TODO: Implement proper permission check based on experiment1, experiment2, and datasource projects.
    // This simplified version only checks organization and assumes broad access.
    if (doc.organization !== this.context.org.id) return false;
    // Replace this with actual permission logic (e.g., checking specific experiment/project rights)
    return true; // Placeholder
  }

  protected canCreate(doc: InteractionSnapshotInterface): boolean {
    const { datasource } = this.getForeignRefs(doc);
    return true;
    // TODO: Implement proper permission check based on experiment1, experiment2, and datasource projects.
    // return this.context.permissions.canCreateInteractionSnapshot({
    //   projects: datasource?.projects || [],
    // })
  }

  protected canUpdate(existing: InteractionSnapshotInterface): boolean {
    return this.canCreate(existing);
  }

  protected canDelete(doc: InteractionSnapshotInterface): boolean {
    return this.canCreate(doc);
  }

  async getLatestInteractionSnapshot(
    context: ReqContext,
    id1: string,
    id2: string,
    withResults: boolean = true
  ): Promise<InteractionSnapshotInterface | null> {
    const snapshots = await this._find({ organization: context.org.id, experimentId1: id1, experimentId2: id2, status: withResults ? "success" : { $in: ["success", "running", "error"] } }, { sort: { dateCreated: -1 } });
    return snapshots[0] || null;
  }
}
