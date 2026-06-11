import { EventForwarderConfigInterface } from "shared/validators";
import { AES } from "crypto-js";
import {
  buildNormalizedEventForwarderSinkPayloadForTest,
  toEventForwarderConfigDraft,
} from "back-end/src/services/eventForwarder/config";

const ENCRYPTION_KEY = "test-encryption-key-for-event-forwarder!!";

jest.mock("back-end/src/util/secrets", () => ({
  ENCRYPTION_KEY: "test-encryption-key-for-event-forwarder!!",
}));

function encryptConfig(config: Record<string, unknown>): string {
  return AES.encrypt(JSON.stringify(config), ENCRYPTION_KEY).toString();
}

describe("event forwarder qualified destinations", () => {
  it("stores parsed BigQuery dataset.prefix from draft", () => {
    const result = buildNormalizedEventForwarderSinkPayloadForTest(
      {
        sinkType: "bigquery",
        config: { tablePrefix: "analytics_123.gb" },
      },
      {
        projectId: "my-project",
        defaultDataset: "other_dataset",
        clientEmail: "svc@test.com",
        privateKey: "test-key",
      },
      null,
    );

    expect(result).toMatchObject({
      dataset: "analytics_123",
      tablePrefix: "gb",
    });
  });

  it("stores parsed Snowflake DATABASE.SCHEMA.PREFIX and draft role/warehouse", () => {
    const result = buildNormalizedEventForwarderSinkPayloadForTest(
      {
        sinkType: "snowflake",
        config: {
          tablePrefix: "EVENT_DB.PUBLIC.gb-",
          accessUrl: "https://myorg-account.snowflakecomputing.com",
          role: "EVENT_ROLE",
          warehouse: "EVENT_WH",
        },
      },
      {
        account: "myorg-account",
        username: "svc_user",
        authMethod: "key-pair",
        privateKey:
          "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----",
        database: "OTHER_DB",
        schema: "OTHER_SCHEMA",
        role: "OTHER_ROLE",
        warehouse: "OTHER_WH",
      },
      null,
    );

    expect(result).toMatchObject({
      database: "EVENT_DB",
      schema: "PUBLIC",
      tablePrefix: "GB",
      accessUrl: "https://myorg-account.snowflakecomputing.com",
      role: "EVENT_ROLE",
      warehouse: "EVENT_WH",
    });
  });

  it("round-trips Snowflake stored config to qualified draft", () => {
    const model = {
      id: "ef_1",
      sinkType: "snowflake",
      config: encryptConfig({
        tablePrefix: "GB",
        account: "myorg-account",
        accessUrl: "https://xy12345.us-east-2.aws.snowflakecomputing.com",
        username: "svc",
        database: "EVENT_DB",
        schema: "PUBLIC",
        privateKey: "abc123",
        role: "EVENT_ROLE",
        warehouse: "EVENT_WH",
      }),
    } as EventForwarderConfigInterface;

    const draft = toEventForwarderConfigDraft(model);
    expect(draft).toEqual({
      sinkType: "snowflake",
      config: {
        tablePrefix: "EVENT_DB.PUBLIC.GB",
        accessUrl: "https://xy12345.us-east-2.aws.snowflakecomputing.com",
        role: "EVENT_ROLE",
        warehouse: "EVENT_WH",
      },
    });
  });
});
