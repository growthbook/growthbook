import { DagInterface, DagNode, dagValidator } from "shared/validators";
import { assertValidDagNodes } from "back-end/src/services/dags";
import { logger } from "back-end/src/util/logger";
import { getCollection } from "back-end/src/util/mongo.util";
import { errorStringFromZodResult } from "back-end/src/util/validation";
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
  protected async customValidation(doc: DagInterface) {
    assertValidDagNodes(doc.nodes);
  }

  /**
   * Points a node at a new attempt, only while it is still on the attempt the
   * caller saw fail. False when another process already replaced it.
   *
   * The attempt is matched by its number as well as its target, so a retry
   * that reuses the same target is still recorded only once.
   *
   * Compare-and-swap with a plain $set of the whole array, so it needs no
   * array update operators.
   */
  public async replaceNodeTarget(
    dagId: string,
    failed: Pick<DagNode, "id" | "targetId" | "previousTargetIds">,
    toTargetId: string,
  ): Promise<boolean> {
    const isFailedAttempt = (node: DagNode) =>
      node.id === failed.id &&
      node.targetId === failed.targetId &&
      node.previousTargetIds.length === failed.previousTargetIds.length;
    const updated = await this.updateWithCas(
      dagId,
      ["status", "nodes"],
      (dag) => {
        if (dag.status !== "active" || !dag.nodes.some(isFailedAttempt)) {
          return null;
        }
        return {
          nodes: dag.nodes.map((node) =>
            isFailedAttempt(node)
              ? {
                  ...node,
                  targetId: toTargetId,
                  previousTargetIds: [...node.previousTargetIds, node.targetId],
                }
              : node,
          ),
        };
      },
    );
    return updated !== null;
  }

  public async markDone(dagId: string): Promise<void> {
    await this._dangerousGetCollection().updateOne(
      { organization: this.context.org.id, id: dagId, status: "active" },
      { $set: { status: "done", dateUpdated: new Date() } },
    );
  }

  /** Cross-tenant query for the DAG job's sweep. */
  public static async dangerousFindAllActive(): Promise<DagInterface[]> {
    const docs = await getCollection(COLLECTION_NAME)
      .find({ status: "active" }, { projection: { _id: 0 } })
      .toArray();
    return docs.flatMap((doc) => {
      const parsed = dagValidator.safeParse(doc);
      if (parsed.success) return [parsed.data];
      logger.warn(
        { dagId: doc.id, error: errorStringFromZodResult(parsed) },
        "Skipping an active DAG that does not match the schema",
      );
      return [];
    });
  }

  protected canRead() {
    return true;
  }
  protected canCreate() {
    return true;
  }
  protected canUpdate() {
    return true;
  }
  protected canDelete() {
    return true;
  }
}
