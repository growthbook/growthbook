import BigQuery from "back-end/src/integrations/BigQuery";

type MockBigQueryJob = {
  id: string;
  getQueryResults: jest.Mock;
  getMetadata: jest.Mock;
};

describe("BigQuery reservation job config", () => {
  let integration: BigQuery;
  let mockJob: MockBigQueryJob;
  let mockCreateQueryJob: jest.Mock;

  beforeEach(() => {
    // @ts-expect-error -- context/datasource not needed for this unit test
    integration = new BigQuery("", {});

    mockJob = {
      id: "job_123",
      getQueryResults: jest.fn().mockResolvedValue([[], undefined, undefined]),
      getMetadata: jest.fn().mockResolvedValue([{}]),
    };

    mockCreateQueryJob = jest.fn().mockResolvedValue([mockJob]);

    jest
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .spyOn(integration as any, "getClient")
      .mockReturnValue({ createQueryJob: mockCreateQueryJob });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("includes reservation in query job config when set", async () => {
    integration.params = {
      reservation:
        "projects/my-project/locations/US/reservations/my-reservation",
    };

    await integration.runQuery("SELECT 1");

    const queryJobConfig = mockCreateQueryJob.mock.calls[0][0];
    expect(queryJobConfig).toEqual({
      labels: { integration: "growthbook" },
      query: "SELECT 1",
      useLegacySql: false,
      reservation:
        "projects/my-project/locations/US/reservations/my-reservation",
    });
  });

  it("does not include reservation in query job config when missing", async () => {
    integration.params = {};

    await integration.runQuery("SELECT 1");

    const queryJobConfig = mockCreateQueryJob.mock.calls[0][0];
    expect(queryJobConfig).toEqual({
      labels: { integration: "growthbook" },
      query: "SELECT 1",
      useLegacySql: false,
    });
    expect(queryJobConfig).not.toHaveProperty("reservation");
  });
});
