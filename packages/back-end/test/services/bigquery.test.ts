import { QueryMetadata } from "shared/types/query";
import { sanitizeQueryMetadataForBigQueryLabels } from "back-end/src/services/bigquery";

// BigQuery label rules (see https://cloud.google.com/bigquery/docs/labels-intro):
// - Each resource can have up to 64 labels.
// - Keys: 1-63 chars, cannot be empty, must start with a lowercase letter
//   (international characters are also allowed by BigQuery, but the current
//   sanitizer strips them), and only contain lowercase letters, digits,
//   underscores, and dashes.
// - Values: 0-63 chars (may be empty), only lowercase letters, digits,
//   underscores, and dashes.
// - Keys must be unique within a single resource (guaranteed here because the
//   result is a Record<string, string>).
const KEY_REGEX = /^[a-z][a-z0-9_-]{0,62}$/;
const VALUE_REGEX = /^[a-z0-9_-]{0,63}$/;

function expectValidBigQueryLabels(labels: Record<string, string>): void {
  expect(Object.keys(labels).length).toBeLessThanOrEqual(64);
  for (const [key, value] of Object.entries(labels)) {
    expect(key.length).toBeGreaterThanOrEqual(1);
    expect(key.length).toBeLessThanOrEqual(63);
    expect(key).toMatch(KEY_REGEX);
    expect(value.length).toBeLessThanOrEqual(63);
    expect(value).toMatch(VALUE_REGEX);
  }
}

describe("sanitizeQueryMetadataForBigQueryLabels", () => {
  describe("input handling", () => {
    it("returns empty object when metadata is undefined", () => {
      expect(sanitizeQueryMetadataForBigQueryLabels(undefined)).toEqual({});
    });

    it("returns empty object when metadata has no defined fields", () => {
      expect(sanitizeQueryMetadataForBigQueryLabels({})).toEqual({});
    });

    it("skips array values (e.g. experimentTags)", () => {
      const labels = sanitizeQueryMetadataForBigQueryLabels({
        experimentTags: ["foo", "bar"],
        experimentOwner: "luke",
      });
      expect(labels).toEqual({ experimentowner: "luke" });
      expectValidBigQueryLabels(labels);
    });

    it("skips undefined and null values", () => {
      const labels = sanitizeQueryMetadataForBigQueryLabels({
        experimentOwner: undefined,
        // BigQuery sanitizer guards against null even though the type forbids it.
        experimentProject: null as unknown as string,
        userName: "Luke",
      });
      expect(labels).toEqual({ username: "luke" });
      expectValidBigQueryLabels(labels);
    });

    it("skips non-string values", () => {
      const labels = sanitizeQueryMetadataForBigQueryLabels({
        experimentOwner: 42 as unknown as string,
        userId: true as unknown as string,
        userName: "luke",
      });
      expect(labels).toEqual({ username: "luke" });
      expectValidBigQueryLabels(labels);
    });
  });

  describe("value sanitization", () => {
    it("lowercases values", () => {
      const labels = sanitizeQueryMetadataForBigQueryLabels({
        userName: "Luke Sonnet",
        userId: "ABC123",
      });
      expect(labels.username).toBe("luke_sonnet");
      expect(labels.userid).toBe("abc123");
      expectValidBigQueryLabels(labels);
    });

    it("replaces disallowed characters with underscores", () => {
      const labels = sanitizeQueryMetadataForBigQueryLabels({
        userName: "luke@example.com",
        experimentOwner: "team/owner+lead",
        experimentProject: "proj.with.dots",
      });
      expect(labels.username).toBe("luke_example_com");
      expect(labels.experimentowner).toBe("team_owner_lead");
      expect(labels.experimentproject).toBe("proj_with_dots");
      expectValidBigQueryLabels(labels);
    });

    it("preserves underscores, dashes, and digits", () => {
      const labels = sanitizeQueryMetadataForBigQueryLabels({
        userName: "luke-sonnet_test-123",
      });
      expect(labels.username).toBe("luke-sonnet_test-123");
      expectValidBigQueryLabels(labels);
    });

    it("strips international/non-ASCII characters", () => {
      // BigQuery technically allows international characters, but the current
      // sanitizer is ASCII-only. Verify the output is still a valid label.
      const labels = sanitizeQueryMetadataForBigQueryLabels({
        userName: "Lükë Sönnêt",
        experimentOwner: "日本語",
      });
      expectValidBigQueryLabels(labels);
      expect(labels.username).toBe("l_k__s_nn_t");
      expect(labels.experimentowner).toBe("___");
    });

    it("truncates values longer than 63 characters", () => {
      const longValue = "a".repeat(200);
      const labels = sanitizeQueryMetadataForBigQueryLabels({
        userName: longValue,
      });
      expect(labels.username).toHaveLength(63);
      expect(labels.username).toBe("a".repeat(63));
      expectValidBigQueryLabels(labels);
    });

    it("accepts empty-string values (BigQuery allows 0-length values)", () => {
      const labels = sanitizeQueryMetadataForBigQueryLabels({
        experimentOwner: "",
        userName: "luke",
      });
      expect(labels.experimentowner).toBe("");
      expect(labels.username).toBe("luke");
      expectValidBigQueryLabels(labels);
    });
  });

  describe("key sanitization", () => {
    it("lowercases keys", () => {
      const labels = sanitizeQueryMetadataForBigQueryLabels({
        userName: "luke",
        userId: "u1",
        experimentOwner: "owner",
        experimentProject: "proj",
        queryType: "experimentMetric",
      });
      expect(Object.keys(labels).sort()).toEqual(
        [
          "username",
          "userid",
          "experimentowner",
          "experimentproject",
          "querytype",
        ].sort(),
      );
      expectValidBigQueryLabels(labels);
    });

    it("prepends 'l_' when sanitized key would not start with a lowercase letter", () => {
      // Use unusual keys to exercise the key-sanitization code paths even
      // though real QueryMetadata keys are all well-formed identifiers.
      const labels = sanitizeQueryMetadataForBigQueryLabels({
        "1leading-digit": "v1",
        "-leading-dash": "v2",
        "_leading-underscore": "v3",
      } as unknown as QueryMetadata);
      expect(labels["l_1leading-digit"]).toBe("v1");
      expect(labels["l_-leading-dash"]).toBe("v2");
      expect(labels["l__leading-underscore"]).toBe("v3");
      expectValidBigQueryLabels(labels);
    });

    it("replaces disallowed characters and uppercases in keys", () => {
      const labels = sanitizeQueryMetadataForBigQueryLabels({
        "Has Spaces & Punctuation!": "v",
      } as unknown as QueryMetadata);
      expect(labels["has_spaces___punctuation_"]).toBe("v");
      expectValidBigQueryLabels(labels);
    });

    it("produces a non-empty key even when the input key is empty or fully invalid", () => {
      const labels = sanitizeQueryMetadataForBigQueryLabels({
        "": "empty-key",
        "@@@": "all-invalid",
      } as unknown as QueryMetadata);
      // Empty key becomes "l_"; all-invalid key becomes "l____" (after
      // replacing each disallowed char with an underscore and prepending the
      // required leading-letter prefix).
      expect(labels["l_"]).toBe("empty-key");
      expect(labels["l____"]).toBe("all-invalid");
      expectValidBigQueryLabels(labels);
    });

    it("truncates keys longer than 63 characters, even after prefixing", () => {
      const longKey = "1" + "a".repeat(100); // starts with digit so gets "l_" prefix
      const labels = sanitizeQueryMetadataForBigQueryLabels({
        [longKey]: "value",
      } as unknown as QueryMetadata);
      const onlyKey = Object.keys(labels)[0];
      expect(onlyKey).toBeDefined();
      expect(onlyKey.length).toBeLessThanOrEqual(63);
      expect(onlyKey.startsWith("l_1")).toBe(true);
      expectValidBigQueryLabels(labels);
    });
  });

  describe("contract: output always satisfies BigQuery label rules", () => {
    it("validates a realistic full-metadata payload", () => {
      const labels = sanitizeQueryMetadataForBigQueryLabels({
        experimentProject: "Growth/Activation",
        experimentOwner: "Luke Sonnet",
        experimentTags: ["should", "be", "ignored"],
        queryType: "experimentMetric",
        userName: "Luke Sonnet",
        userId: "user_abc-123",
      });
      expectValidBigQueryLabels(labels);
      expect(labels).toEqual({
        experimentproject: "growth_activation",
        experimentowner: "luke_sonnet",
        querytype: "experimentmetric",
        username: "luke_sonnet",
        userid: "user_abc-123",
      });
    });

    it("produces valid labels for a variety of pathological inputs", () => {
      const pathological: Record<string, unknown> = {
        "": "",
        "1": "1",
        "-": "-",
        _: "_",
        [`${"A".repeat(100)}`]: "B".repeat(100),
        "key with spaces": "value with spaces",
        "key.with.dots": "value.with.dots",
        "🚀": "🚀",
        "MiXeD-CaSe_123": "MiXeD-CaSe_123",
      };
      const labels = sanitizeQueryMetadataForBigQueryLabels(
        pathological as unknown as QueryMetadata,
      );
      expectValidBigQueryLabels(labels);
    });
  });
});
