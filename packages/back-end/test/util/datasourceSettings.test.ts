import { DataSourceInterface } from "shared/types/datasource";
import {
  assertDatasourceSettingsReadable,
  upgradeReadableDatasources,
  upgradeReadableDatasourcesByIds,
} from "back-end/src/util/datasourceSettings";
import { logger } from "back-end/src/util/logger";

jest.mock("back-end/src/util/logger", () => ({
  logger: {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  },
}));

function makeDatasource(
  id: string,
  settings: unknown = {},
): DataSourceInterface {
  return {
    id,
    name: id,
    description: "",
    organization: "org_1",
    type: "mixpanel",
    params: "",
    projects: [],
    dateCreated: new Date(),
    dateUpdated: new Date(),
    settings: settings as DataSourceInterface["settings"],
  } as DataSourceInterface;
}

const malformedSettings = { queries: { exposure: "not-an-array" } };

describe("assertDatasourceSettingsReadable", () => {
  it("accepts settings the read upgrade can handle", () => {
    expect(() =>
      assertDatasourceSettingsReadable(makeDatasource("ds_ok")),
    ).not.toThrow();
  });

  it("refuses settings the read upgrade throws on", () => {
    expect(() =>
      assertDatasourceSettingsReadable(
        makeDatasource("ds_bad", malformedSettings),
      ),
    ).toThrow(
      /^The Data Source was not saved because its settings are malformed: .+/,
    );
  });

  it("does not modify the data source it checks", () => {
    const datasource = makeDatasource("ds_ok");
    assertDatasourceSettingsReadable(datasource);
    expect(datasource.settings).toEqual({});
  });
});

describe("upgradeReadableDatasources", () => {
  beforeEach(() => {
    jest.mocked(logger.error).mockClear();
  });

  it("skips data sources whose upgrade throws and logs them", () => {
    const result = upgradeReadableDatasources([
      makeDatasource("ds_a"),
      makeDatasource("ds_bad", malformedSettings),
      makeDatasource("ds_b"),
    ]);

    expect(result.map((ds) => ds.id)).toEqual(["ds_a", "ds_b"]);
    expect(result[0].settings.userIdTypes?.length).toBeGreaterThan(0);
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      expect.any(Error),
      "Data Source ds_bad has malformed stored settings and was treated as missing",
    );
  });

  it("logs nothing when every data source is readable", () => {
    expect(upgradeReadableDatasources([makeDatasource("ds_a")])).toHaveLength(
      1,
    );
    expect(logger.error).not.toHaveBeenCalled();
  });
});

describe("upgradeReadableDatasourcesByIds", () => {
  beforeEach(() => {
    jest.mocked(logger.error).mockClear();
  });

  it("ignores a malformed data source that wasn't requested", () => {
    const result = upgradeReadableDatasourcesByIds(
      [makeDatasource("ds_a"), makeDatasource("ds_bad", malformedSettings)],
      ["ds_a"],
    );

    expect(result.map((ds) => ds.id)).toEqual(["ds_a"]);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("skips and logs a requested malformed data source", () => {
    const result = upgradeReadableDatasourcesByIds(
      [makeDatasource("ds_a"), makeDatasource("ds_bad", malformedSettings)],
      ["ds_a", "ds_bad"],
    );

    expect(result.map((ds) => ds.id)).toEqual(["ds_a"]);
    expect(logger.error).toHaveBeenCalledWith(
      expect.any(Error),
      "Data Source ds_bad has malformed stored settings and was treated as missing",
    );
  });
});
