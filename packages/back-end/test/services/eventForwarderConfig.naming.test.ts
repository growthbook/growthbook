import {
  getEventForwarderTopicName,
  isInHouseConsumerTopic,
} from "back-end/src/services/eventForwarder/config";

describe("event forwarder per-datasource naming", () => {
  it("getEventForwarderTopicName differs by datasource id", () => {
    const org = "org_abc";
    const t1 = getEventForwarderTopicName(org, "ds_one");
    const t2 = getEventForwarderTopicName(org, "ds_two");
    expect(t1).not.toEqual(t2);
    expect(t1).toContain("ds_one");
    expect(t2).toContain("ds_two");
  });

  it("isInHouseConsumerTopic matches the shared topic and per-org overrides only", () => {
    expect(isInHouseConsumerTopic("event_forwarder_bigquery", "bigquery")).toBe(
      true,
    );
    expect(
      isInHouseConsumerTopic("event_forwarder_bigquery__org_1", "bigquery"),
    ).toBe(true);
    expect(
      isInHouseConsumerTopic(
        getEventForwarderTopicName("org_1", "ds_1"),
        "bigquery",
      ),
    ).toBe(false);
    expect(
      isInHouseConsumerTopic("event_forwarder_databricks", "bigquery"),
    ).toBe(false);
  });
});
