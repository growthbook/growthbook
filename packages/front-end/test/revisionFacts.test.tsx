import { isValidElement, ReactElement } from "react";
import { MinimalFeatureRevisionInterface } from "shared/types/feature-revision";
import { revisionFacts } from "@/components/Features/revisionFacts";

const member = (id: string) => ({
  type: "dashboard" as const,
  id,
  name: id,
  email: `${id}@example.com`,
});
const keyActingAsItself = {
  type: "api_key" as const,
  apiKey: "key_1",
  name: "Slackbot",
};

function revision(
  overrides: Partial<MinimalFeatureRevisionInterface>,
): MinimalFeatureRevisionInterface {
  return {
    version: 5,
    datePublished: null,
    dateUpdated: new Date("2026-11-01T00:00:00Z"),
    createdBy: member("u_author"),
    status: "draft",
    comment: "",
    ...overrides,
  };
}

// The people a fact names through `person`, in order.
function facts(rev: MinimalFeatureRevisionInterface, liveVersion = 5) {
  const named: string[] = [];
  const list = revisionFacts(rev, liveVersion, (id) => {
    named.push(id);
    return <span data-person={id} />;
  });
  return { labels: list.map((f) => f.label), list, named };
}

describe("revisionFacts", () => {
  it("names the author and co-authors, without repeating the author", () => {
    const { labels, named } = facts(
      revision({ contributors: ["u_author", "u_other"] }),
    );
    expect(labels).toEqual(["Revised by", "Co-author", "Last update"]);
    expect(named).toEqual(["u_author", "u_other"]);
  });

  it("matches a key acting as itself by its identity, not as a member", () => {
    const { labels, list, named } = facts(
      revision({
        createdBy: keyActingAsItself,
        contributors: ["key_1", "u_other"],
      }),
    );
    expect(labels).toEqual(["Revised by", "Co-author", "Last update"]);
    // The key is drawn as an event user; only the member goes through person.
    expect(named).toEqual(["u_other"]);
    const revisedBy = list[0].value as ReactElement;
    expect(isValidElement(revisedBy)).toBe(true);
    expect(revisedBy.props).not.toHaveProperty("data-person");
  });

  it("notes the base of a draft built on an older revision", () => {
    const { list } = facts(revision({ baseVersion: 3 }), 4);
    expect(list[0]).toEqual({ label: "Based on", value: "Revision 3" });
  });

  it("dates a published revision by its publish, and a draft's schedule", () => {
    expect(
      facts(
        revision({
          status: "published",
          datePublished: new Date("2026-10-01T00:00:00Z"),
        }),
      ).labels,
    ).toEqual(["Revised by", "Published"]);
    expect(
      facts(revision({ scheduledPublishAt: new Date("2026-12-01T00:00:00Z") }))
        .labels,
    ).toEqual(["Revised by", "Last update", "Publishes"]);
  });
});
