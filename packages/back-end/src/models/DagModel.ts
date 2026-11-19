import mongoose from "mongoose";
import { UpdateProps } from "shared/types/base-model";
import { DagInterface, dagValidator } from "shared/validators";
import { MakeModelClass } from "./BaseModel";

export const COLLECTION_NAME = "dags";

const BaseClass = MakeModelClass({
  schema: dagValidator,
  collectionName: COLLECTION_NAME,
  idPrefix: "dag_",
  globallyUniquePrimaryKeys: true,
  // No organization prefix: dangerousFindAllActive is a cross-tenant query
  additionalIndexes: [{ fields: { status: 1 } }],
});

export class DagModel extends BaseClass {
  /**
   * Points a node at a new attempt, only while it still points at the attempt
   * the caller saw fail. False when another process already replaced it.
   */
  public async replaceNodeTarget(
    dagId: string,
    nodeId: string,
    fromTargetId: string,
    toTargetId: string,
  ): Promise<boolean> {
    const result = await this._dangerousGetCollection().updateOne(
      {
        organization: this.context.org.id,
        id: dagId,
        status: "active",
        nodes: { $elemMatch: { id: nodeId, targetId: fromTargetId } },
      },
      {
        $set: { "nodes.$.targetId": toTargetId, dateUpdated: new Date() },
        $push: { "nodes.$.previousTargetIds": fromTargetId },
      },
    );
    return result.matchedCount > 0;
  }

  public async markDone(dagId: string): Promise<void> {
    await this._dangerousGetCollection().updateOne(
      { organization: this.context.org.id, id: dagId, status: "active" },
      { $set: { status: "done", dateUpdated: new Date() } },
    );
  }

  /** Cross-tenant query for the DAG job's sweep. Do not use elsewhere. */
  public static async dangerousFindAllActive(): Promise<DagInterface[]> {
    const docs = await mongoose.connection.db
      .collection(COLLECTION_NAME)
      .find({ status: "active" }, { projection: { _id: 0 } })
      .toArray();
    return docs.flatMap((doc) => {
      const parsed = dagValidator.safeParse(doc);
      return parsed.success ? [parsed.data] : [];
    });
  }

  protected canRead(_doc: DagInterface) {
    return true;
  }
  protected canCreate(_doc: DagInterface) {
    return true;
  }
  protected canUpdate(
    _existing: DagInterface,
    _updates: UpdateProps<DagInterface>,
    _newDoc: DagInterface,
  ) {
    return true;
  }
  protected canDelete(_existing: DagInterface) {
    return true;
  }
}
