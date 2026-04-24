import type { EventForwarderConfigInterface } from "shared/validators";
import { getEventForwarderTopicName } from "back-end/src/services/eventForwarderConfig";
import { getEventForwarderConnectorName } from "back-end/src/services/eventForwarderProvisioning";

function minimalEfc(
  overrides: Partial<EventForwarderConfigInterface>,
): EventForwarderConfigInterface {
  return {
    id: "efc_test",
    organization: "org_test",
    datasourceId: "ds_a",
    projects: ["p1"],
    topic: "t",
    schemaId: 1,
    sinkType: "bigquery",
    config: "{}",
    status: "pending",
    dateCreated: new Date(),
    dateUpdated: new Date(),
    ...overrides,
  };
}

describe("event forwarder per-datasource naming", () => {
  it("getEventForwarderTopicName differs by datasource id", () => {
    const org = "org_abc";
    const t1 = getEventForwarderTopicName(org, "ds_one");
    const t2 = getEventForwarderTopicName(org, "ds_two");
    expect(t1).not.toEqual(t2);
    expect(t1).toContain("ds_one");
    expect(t2).toContain("ds_two");
  });

  it("getEventForwarderConnectorName differs by datasource id and stays within 64 chars", () => {
    const a = getEventForwarderConnectorName(
      minimalEfc({ datasourceId: "ds_short" }),
    );
    const b = getEventForwarderConnectorName(
      minimalEfc({ datasourceId: "ds_other" }),
    );
    expect(a).not.toEqual(b);
    expect(a.length).toBeLessThanOrEqual(64);
    expect(b.length).toBeLessThanOrEqual(64);
  });
});
