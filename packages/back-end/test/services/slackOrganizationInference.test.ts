import type { SlackOrganizationChoice } from "back-end/src/services/slack/slackIdentity";
import {
  inferSlackOrganizationByName,
  parseSlackResourceReferences,
} from "back-end/src/services/slack/slackOrganizationInference";

const APP_ORIGIN = "https://app.example.com";

describe("parseSlackResourceReferences", () => {
  it("parses experiment and feature links, labelled or not", () => {
    expect(
      parseSlackResourceReferences(
        "<https://app.example.com/experiment/exp_abc> and <https://app.example.com/features/my-flag|My flag>",
        APP_ORIGIN,
      ),
    ).toEqual([
      { kind: "experiment", id: "exp_abc" },
      { kind: "feature", id: "my-flag" },
    ]);
  });

  it("treats an app origin with a trailing slash the same as one without", () => {
    const text = "<https://app.example.com/experiment/exp_abc>";
    const expected = [{ kind: "experiment", id: "exp_abc" }];

    expect(parseSlackResourceReferences(text, APP_ORIGIN)).toEqual(expected);
    expect(
      parseSlackResourceReferences(text, "https://app.example.com/"),
    ).toEqual(expected);
  });

  it.each([
    {
      label: "a link to another origin",
      text: "<https://evil.example.com/experiment/exp_abc>",
    },
    {
      label: "a path we do not resolve",
      text: "<https://app.example.com/metric/met_1>",
    },
    {
      label: "a path that merely starts with the prefix",
      text: "<https://app.example.com/experimentfoo/exp_1>",
    },
    { label: "a missing id", text: "<https://app.example.com/experiment/>" },
    {
      label: "an empty first segment",
      text: "<https://app.example.com/experiment//exp_1>",
    },
    { label: "a user mention", text: "<@U123>" },
    { label: "a channel reference", text: "<#C123|general>" },
    { label: "prose about an experiment", text: "how did the experiment go?" },
  ])("ignores $label", ({ text }) => {
    expect(parseSlackResourceReferences(text, APP_ORIGIN)).toEqual([]);
  });

  it("drops trailing path segments, query, and hash", () => {
    expect(
      parseSlackResourceReferences(
        "<https://app.example.com/experiment/exp_1/results?x=1#y>",
        APP_ORIGIN,
      ),
    ).toEqual([{ kind: "experiment", id: "exp_1" }]);
  });

  it("decodes percent-encoded characters in a feature id", () => {
    expect(
      parseSlackResourceReferences(
        "<https://app.example.com/features/my%20flag>",
        APP_ORIGIN,
      ),
    ).toEqual([{ kind: "feature", id: "my flag" }]);
  });

  it("returns a repeated resource only once", () => {
    expect(
      parseSlackResourceReferences(
        "<https://app.example.com/experiment/exp_1> then <https://app.example.com/experiment/exp_1|again>",
        APP_ORIGIN,
      ),
    ).toEqual([{ kind: "experiment", id: "exp_1" }]);
  });
});

describe("inferSlackOrganizationByName", () => {
  const choice = (name: string, suffix: string): SlackOrganizationChoice => ({
    organizationId: `org_${suffix}`,
    name,
    linkId: `link_${suffix}`,
  });

  it("returns the one choice whose name appears, ignoring case", () => {
    const acme = choice("Acme", "1");
    expect(
      inferSlackOrganizationByName("please check ACME today", [
        acme,
        choice("Globex", "2"),
      ]),
    ).toBe(acme);
  });

  it("does not match a name embedded in a longer word", () => {
    expect(
      inferSlackOrganizationByName("Acmeco ships tomorrow", [
        choice("Acme", "1"),
      ]),
    ).toBeNull();
  });

  it("does not match a name followed by a non-ascii letter", () => {
    expect(
      inferSlackOrganizationByName("the Acmé rollout", [choice("Acme", "1")]),
    ).toBeNull();
  });

  it("matches a name that contains punctuation", () => {
    const acme = choice("Acme, Inc.", "1");
    expect(
      inferSlackOrganizationByName("this is for Acme, Inc. thanks", [acme]),
    ).toBe(acme);
  });

  it("treats regex metacharacters in a name as literal text", () => {
    const wildcard = choice("A*B", "1");

    expect(inferSlackOrganizationByName("the A*B rollout", [wildcard])).toBe(
      wildcard,
    );
    expect(
      inferSlackOrganizationByName("the AAAB rollout", [wildcard]),
    ).toBeNull();
  });

  it("returns null when no name appears", () => {
    expect(
      inferSlackOrganizationByName("nothing relevant here", [
        choice("Acme", "1"),
        choice("Globex", "2"),
      ]),
    ).toBeNull();
  });

  it("returns null when two different names appear", () => {
    expect(
      inferSlackOrganizationByName("Acme and Globex both replied", [
        choice("Acme", "1"),
        choice("Globex", "2"),
      ]),
    ).toBeNull();
  });

  it("returns null when two choices share the matching name", () => {
    expect(
      inferSlackOrganizationByName("ping Acme about it", [
        choice("Acme", "1"),
        choice("Acme", "2"),
      ]),
    ).toBeNull();
  });

  it("never matches a choice whose name is blank", () => {
    const blank = choice("   ", "1");
    const acme = choice("Acme", "2");

    expect(inferSlackOrganizationByName("ping someone", [blank])).toBeNull();
    expect(
      inferSlackOrganizationByName("ping Acme about it", [blank, acme]),
    ).toBe(acme);
  });
});
