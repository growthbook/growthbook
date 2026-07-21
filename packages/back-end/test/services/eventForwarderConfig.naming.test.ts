import { getEventForwarderTopicName } from "back-end/src/services/eventForwarder/config";

describe("event forwarder per-datasource naming", () => {
  it("getEventForwarderTopicName differs by datasource id", () => {
    const org = "org_abc";
    const t1 = getEventForwarderTopicName(org, "ds_one");
    const t2 = getEventForwarderTopicName(org, "ds_two");
    expect(t1).not.toEqual(t2);
    expect(t1).toContain("ds_one");
    expect(t2).toContain("ds_two");
  });
});
