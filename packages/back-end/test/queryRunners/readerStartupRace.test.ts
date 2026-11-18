import mongoose from "mongoose";
import { Queries } from "shared/types/query";
import { ExperimentSnapshotInterface } from "shared/types/experiment-snapshot";
import {
  connectTestMongo,
  disconnectTestMongo,
} from "back-end/test/test-helpers";
import { snapshotFactory } from "back-end/test/factories/Snapshot.factory";
import {
  COLLECTION_NAME,
  IncrementalRefreshModel,
} from "back-end/src/models/IncrementalRefreshModel";
import { ExperimentSnapshotAnalysisChunkModel } from "back-end/src/models/ExperimentSnapshotAnalysisChunkModel";
import { SqlResultChunkModel } from "back-end/src/models/SqlResultChunkModel";
import {
  createExperimentSnapshotModel,
  findSnapshotById,
} from "back-end/src/models/ExperimentSnapshotModel";
import { getQueriesByIds } from "back-end/src/models/QueryModel";
import {
  ExperimentIncrementalRefreshExploratoryQueryParams,
  ExperimentIncrementalRefreshExploratoryQueryRunner,
} from "back-end/src/queryRunners/ExperimentIncrementalRefreshExploratoryQueryRunner";
import { SnapshotResult } from "back-end/src/queryRunners/ExperimentResultsQueryRunner";
import {
  interruptIncrementalReaders,
  SNAPSHOT_INTERRUPTED_ERROR,
} from "back-end/src/services/snapshotCancellation";
import { getIntegrationFromDatasourceId } from "back-end/src/services/datasource";
import { SourceIntegrationInterface } from "back-end/src/types/Integration";
import { ReqContext } from "back-end/types/request";

jest.mock("back-end/src/services/datasource", () => ({
  getIntegrationFromDatasourceId: jest.fn(),
}));

const organization = "org_1";
const experimentId = "exp_race";
const settingsHash = "hash";

// Keeps the real startAnalysis, updateModel, refresh loop and lock calls.
// Only SQL generation and the stats engine are replaced.
class StartingReader extends ExperimentIncrementalRefreshExploratoryQueryRunner {
  public whileStarting: () => Promise<void> = async () => {};
  public finishQuery: () => void = () => {};

  override async startQueries(): Promise<Queries> {
    const queryFinished = new Promise<void>((resolve) => {
      this.finishQuery = resolve;
    });
    const pointer = await this.startQuery({
      name: "statistics_group",
      query: "SELECT 1",
      dependencies: [],
      run: async () => {
        await queryFinished;
        return { rows: [] };
      },
      process: (rows) => rows,
      queryType: "experimentIncrementalRefreshStatistics",
    });
    await this.whileStarting();
    return [pointer];
  }

  override async runAnalysis(): Promise<SnapshotResult> {
    return { unknownVariations: [], multipleExposures: 0, analyses: [] };
  }
}

describe("reader interrupted while its queries are starting", () => {
  let context: ReqContext;
  let integration: SourceIntegrationInterface;

  beforeAll(connectTestMongo);
  afterAll(disconnectTestMongo);

  beforeEach(() => {
    context = {
      org: { id: organization, settings: {} },
      populateForeignRefs: jest.fn().mockResolvedValue(undefined),
      permissions: {
        canRunExperimentQueries: () => true,
        throwPermissionError: () => {
          throw new Error("permission denied");
        },
      },
      models: {},
      logger: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
      },
    } as unknown as ReqContext;
    context.models.incrementalRefresh = new IncrementalRefreshModel(context);
    context.models.experimentSnapshotAnalysisChunks =
      new ExperimentSnapshotAnalysisChunkModel(context);
    context.models.sqlResultChunks = new SqlResultChunkModel(context);
    integration = {
      context,
      datasource: { id: "ds_1", type: "bigquery", settings: {} },
      getSourceProperties: () => ({ queryLanguage: "sql" }),
      cancelQuery: jest.fn().mockResolvedValue(undefined),
    } as unknown as SourceIntegrationInterface;
    jest.mocked(getIntegrationFromDatasourceId).mockResolvedValue(integration);
  });

  afterEach(async () => {
    jest.clearAllMocks();
    const collections = mongoose.connection.collections;
    for (const key in collections) {
      await collections[key].deleteMany({});
    }
    // BaseModel collections are not registered with mongoose.
    await mongoose.connection.db!.collection(COLLECTION_NAME).deleteMany({});
  });

  async function startReader(): Promise<{
    reader: StartingReader;
    snapshot: ExperimentSnapshotInterface;
  }> {
    const locks = context.models.incrementalRefresh;
    // An earlier Overall Results run created the state document.
    await locks.acquireLock({
      experimentId,
      phase: 0,
      snapshotId: "snp_first_overall",
      legacyExperimentSettingsHash: settingsHash,
    });
    await locks.releaseLock(experimentId, "snp_first_overall");

    const snapshot = await createExperimentSnapshotModel({
      context,
      data: snapshotFactory.build({
        organization,
        experiment: experimentId,
        status: "running",
        type: "exploratory",
        dimension: "country",
      }),
    });
    expect(
      await locks.acquireReaderLock({
        experimentId,
        phase: 0,
        snapshotId: snapshot.id,
        request: { type: "dimension", dimension: "country" },
        legacyExperimentSettingsHash: settingsHash,
      }),
    ).toBe(true);

    return {
      reader: new StartingReader(context, snapshot, integration, false),
      snapshot,
    };
  }

  async function writerTakesOver(writerId: string) {
    expect(
      await context.models.incrementalRefresh.acquireLock({
        experimentId,
        phase: 0,
        snapshotId: writerId,
        legacyExperimentSettingsHash: settingsHash,
      }),
    ).toBe(true);
    await interruptIncrementalReaders(context, experimentId, writerId);
  }

  const params = {
    experimentId,
  } as unknown as ExperimentIncrementalRefreshExploratoryQueryParams;

  it("cancels the run when a writer arrives between query launch and the query list being saved", async () => {
    const { reader, snapshot } = await startReader();

    let afterInterrupt: ExperimentSnapshotInterface | null = null;
    reader.whileStarting = async () => {
      await writerTakesOver("snp_writer");
      afterInterrupt = await findSnapshotById(context, snapshot.id);
    };

    const started = await reader.startAnalysis(params);
    const afterStart = await findSnapshotById(context, snapshot.id);
    // The writer saw an empty query list, so only the reader could fail this.
    const [queryAfterStart] = await getQueriesByIds(
      context,
      started.queries.map((q) => q.query),
    );
    // The warehouse query was already running, so it completes.
    reader.finishQuery();
    await reader.waitForResults();
    const final = await findSnapshotById(context, snapshot.id);

    expect(afterInterrupt!.status).toBe("error");
    expect(afterInterrupt!.error).toBe(SNAPSHOT_INTERRUPTED_ERROR);
    expect(afterStart?.status).toBe("error");
    expect(queryAfterStart.status).toBe("failed");
    expect(queryAfterStart.error).toBe(SNAPSHOT_INTERRUPTED_ERROR);
    expect(final?.status).toBe("error");
    expect(final?.error).toBe(SNAPSHOT_INTERRUPTED_ERROR);
  });

  it("still succeeds when no writer arrives", async () => {
    const { reader, snapshot } = await startReader();

    await reader.startAnalysis(params);
    reader.finishQuery();
    await reader.waitForResults();

    const final = await findSnapshotById(context, snapshot.id);
    expect(final?.status).toBe("success");
    expect(final?.error).toBe("");
    const doc =
      await context.models.incrementalRefresh.getByExperimentIdAndPhase(
        experimentId,
        0,
      );
    expect(doc?.readers).toEqual([]);
  });
});
