import { createHash } from "crypto";
import { trackEventForContext } from "back-end/src/services/growthbook";
import {
  revisionActivityEventName,
  trackRevisionActivity,
} from "back-end/src/events/revisionActivityTracking";

jest.mock("back-end/src/services/growthbook", () => ({
  trackEventForContext: jest.fn(),
}));

const md5 = (value: string) => createHash("md5").update(value).digest("hex");

describe("revisionActivityEventName", () => {
  it.each([
    ["created", "Revision Created"],
    ["reviewRequested", "Revision Review Requested"],
    ["changesRequested", "Revision Changes Requested"],
    ["publishScheduleChanged", "Revision Publish Schedule Changed"],
  ])("names %s %s", (action, name) => {
    expect(revisionActivityEventName(action)).toBe(name);
  });
});

describe("trackRevisionActivity", () => {
  const context = {
    org: { id: "org_123" },
    auditUser: { type: "dashboard", id: "u_1" },
  } as unknown as Parameters<typeof trackRevisionActivity>[0];
  const logged = jest.mocked(trackEventForContext);

  beforeEach(() => logged.mockClear());

  it("logs a revision event with its resource, action, actor and hashed ids", () => {
    trackRevisionActivity(context, "savedGroup", "revision.published", "sg_1", {
      object: { version: 3 },
    });
    expect(logged).toHaveBeenCalledWith(context, "Revision Published", {
      resource: "savedGroup",
      action: "published",
      actor: "dashboard",
      entity_id_hash: md5("org_123:sg_1"),
      revision_id_hash: md5("org_123:sg_1:3"),
      revision_version: 3,
    });
  });

  it("leaves out what the event doesn't carry", () => {
    trackRevisionActivity(context, "feature", "revision.created", "f1", {});
    expect(logged).toHaveBeenCalledWith(context, "Revision Created", {
      resource: "feature",
      action: "created",
      actor: "dashboard",
      entity_id_hash: md5("org_123:f1"),
    });
    logged.mockClear();
    trackRevisionActivity(context, "feature", "revision.created", null, {
      object: { version: 1 },
    });
    expect(logged).toHaveBeenCalledWith(context, "Revision Created", {
      resource: "feature",
      action: "created",
      actor: "dashboard",
    });
  });

  it("ignores events that aren't about a revision", () => {
    trackRevisionActivity(context, "feature", "updated", "f1", {});
    expect(logged).not.toHaveBeenCalled();
  });
});
