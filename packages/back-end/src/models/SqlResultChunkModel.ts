import { decodeSQLResults, encodeSQLResults } from "shared/sql";
import { sqlResultChunkValidator } from "shared/validators";
import { QueryInterface, SqlResultChunkInterface } from "shared/types/query";
import { promiseAllChunks } from "back-end/src/util/promise";
import { MakeModelClass } from "./BaseModel";

const BaseClass = MakeModelClass({
  schema: sqlResultChunkValidator,
  collectionName: "sqlresultchunks",
  idPrefix: "sqlres_",
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
    await promiseAllChunks(
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

  public async addResultsToQueries(queries: QueryInterface[]) {
    const idsToFetch = queries
      .filter((q) => q.hasChunkedResults)
      .map((q) => (q.cachedQueryUsed ? q.cachedQueryUsed : q.id));

    if (!idsToFetch.length) return;

    const allChunks = await this._find(
      {
        queryId: { $in: idsToFetch },
      },
      {
        sort: { queryId: 1, chunkNumber: 1 },
      },
    );
    const chunksByQueryId: Record<string, SqlResultChunkInterface[]> = {};
    for (const chunk of allChunks) {
      if (!chunksByQueryId[chunk.queryId]) {
        chunksByQueryId[chunk.queryId] = [];
      }
      chunksByQueryId[chunk.queryId].push(chunk);
    }
    for (const query of queries) {
      const queryId = query.cachedQueryUsed ? query.cachedQueryUsed : query.id;
      if (chunksByQueryId[queryId]) {
        const result = decodeSQLResults(chunksByQueryId[queryId]);
        query.rawResult = result;
        query.result = result;
      }
    }
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

  public async deleteAllByQueryId(queryId: string) {
    await this._dangerousGetCollection().deleteMany({
      organization: this.context.org.id,
      queryId,
    });
  }
}
