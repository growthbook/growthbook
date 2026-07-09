import { UpdateProps } from "shared/types/base-model";
import {
  AggregatedFactTableRunInterface,
  aggregatedFactTableRunValidator,
} from "shared/validators";
import { MakeModelClass } from "./BaseModel";

export const COLLECTION_NAME = "aggregatedfacttableruns";

const ID_PREFIX = "aftr_";

const BaseClass = MakeModelClass({
  schema: aggregatedFactTableRunValidator,
  collectionName: COLLECTION_NAME,
  idPrefix: ID_PREFIX,
  globallyUniquePrimaryKeys: true,
  additionalIndexes: [
    {
      fields: {
        organization: 1,
        factTableId: 1,
        idType: 1,
        dateCreated: -1,
      },
    },
  ],
});

export class AggregatedFactTableRunModel extends BaseClass {
  // Raw field setter: the registry lock already serializes runs, so this skips
  // the audit overhead of a full BaseModel update on every QueryRunner poll.
  public async updateRunFields(
    id: string,
    data: UpdateProps<AggregatedFactTableRunInterface>,
  ) {
    await this._dangerousGetCollection().updateOne(
      { organization: this.context.org.id, id },
      { $set: { ...data, dateUpdated: new Date() } },
    );
  }

  public async getByFactTableAndIdType(
    factTableId: string,
    idType: string | undefined,
    { limit, skip }: { limit: number; skip: number },
  ): Promise<{ runs: AggregatedFactTableRunInterface[]; total: number }> {
    const filter = { factTableId, ...(idType ? { idType } : {}) };
    const [runs, total] = await Promise.all([
      this._find(filter, { sort: { dateCreated: -1 }, limit, skip }),
      this._countDocuments(filter),
    ]);
    return { runs, total };
  }

  protected canRead(_doc: AggregatedFactTableRunInterface) {
    return true;
  }
  protected canCreate(_doc: AggregatedFactTableRunInterface) {
    return true;
  }
  protected canUpdate(
    _existing: AggregatedFactTableRunInterface,
    _updates: UpdateProps<AggregatedFactTableRunInterface>,
    _newDoc: AggregatedFactTableRunInterface,
  ) {
    return true;
  }
  protected canDelete(_existing: AggregatedFactTableRunInterface) {
    return true;
  }
}
