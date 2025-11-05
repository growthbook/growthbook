import { decodeSQLResults, encodeSQLResults } from "shared/sql";
import { sqlResultChunkValidator } from "back-end/src/validators/queries";
import { promiseAllChunks } from "back-end/src/util/promise";
import { MakeModelClass } from "./BaseModel";

const BaseClass = MakeModelClass({
  schema: sqlResultChunkValidator,
  collectionName: "sqlresultchunks",
  idPrefix: "sqlres_",
  auditLog: {
    entity: "sqlResultChunk",
    createEvent: "sqlResultChunk.create",
    updateEvent: "sqlResultChunk.update",
    deleteEvent: "sqlResultChunk.delete",
  },
  globallyUniqueIds: true,
  additionalIndexes: [
    { fields: { organization: 1, queryId: 1, chunkNumber: 1 }, unique: true },
  ],
});

export class SqlResultChunkModel extends BaseClass {
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

  public async createFromResults(
    queryId: string,
    results: Record<string, unknown>[],
  ) {
    const encodedChunks = encodeSQLResults(results);
    return promiseAllChunks(
      encodedChunks.map((chunk, i) => async () => {
        await this.create({
          queryId,
          chunkNumber: i,
          ...chunk,
        });
      }),
      3,
    );
  }

  public async getResultsByQueryId(queryId: string) {
    const all = await this._find(
      { queryId },
      {
        sort: { chunkNumber: 1 },
      },
    );
    return decodeSQLResults(all);
  }
}
