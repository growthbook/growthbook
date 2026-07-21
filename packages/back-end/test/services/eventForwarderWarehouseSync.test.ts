import { queueDelayedFactTableColumnsRefreshForDatasource } from "back-end/src/services/eventForwarder/factTable";
import { queueDelayedEventForwarderWarehouseSyncForDatasource } from "back-end/src/services/eventForwarder/warehouseSync";
import { queueRevalidateEventForwarderDataSourceQueriesAt } from "back-end/src/jobs/revalidateEventForwarderDataSourceQueries";

jest.mock("back-end/src/services/eventForwarder/factTable", () => ({
  queueDelayedFactTableColumnsRefreshForDatasource: jest.fn(),
}));

jest.mock(
  "back-end/src/jobs/revalidateEventForwarderDataSourceQueries",
  () => ({
    queueRevalidateEventForwarderDataSourceQueriesAt: jest.fn(),
  }),
);

const factTableRefreshMock =
  queueDelayedFactTableColumnsRefreshForDatasource as jest.MockedFunction<
    typeof queueDelayedFactTableColumnsRefreshForDatasource
  >;
const revalidateJobMock =
  queueRevalidateEventForwarderDataSourceQueriesAt as jest.MockedFunction<
    typeof queueRevalidateEventForwarderDataSourceQueriesAt
  >;

describe("eventForwarderWarehouseSync", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("queues fact table column refresh and delayed query revalidation", async () => {
    const context = { org: { id: "org1" } };

    await queueDelayedEventForwarderWarehouseSyncForDatasource(
      context as never,
      "ds_1",
      60_000,
    );

    expect(factTableRefreshMock).toHaveBeenCalledWith(context, "ds_1", 60_000);
    expect(revalidateJobMock).toHaveBeenCalledWith(
      "org1",
      "ds_1",
      expect.any(Date),
    );
  });
});
