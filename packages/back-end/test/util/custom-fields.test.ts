import { CustomField } from "shared/types/custom-fields";
import {
  shouldValidateCustomFieldsOnUpdate,
  validateCustomFieldsForSection,
} from "back-end/src/util/custom-fields";

const buildCustomField = (
  overrides: Partial<CustomField> = {},
): CustomField => ({
  id: "cfd_test",
  name: "Test Field",
  type: "text",
  required: false,
  section: "feature",
  dateCreated: new Date("2026-01-01"),
  dateUpdated: new Date("2026-01-01"),
  ...overrides,
});

const buildCustomFieldsModel = (fields: CustomField[] | null | undefined) => ({
  getCustomFieldsBySectionAndProject: jest.fn().mockResolvedValue(fields),
});

describe("custom fields validation", () => {
  describe("validateCustomFieldsForSection", () => {
    const validate = async ({
      fields,
      values,
      section = "feature",
    }: {
      fields: CustomField[];
      values?: Record<string, unknown>;
      section?: "feature" | "experiment";
    }) => {
      return validateCustomFieldsForSection({
        customFieldValues: values,
        customFieldsModel: buildCustomFieldsModel(fields),
        section,
      });
    };

    it("allows an empty payload when no custom fields are configured", async () => {
      await expect(
        validateCustomFieldsForSection({
          customFieldValues: {},
          customFieldsModel: buildCustomFieldsModel([]),
          section: "feature",
        }),
      ).resolves.toBeUndefined();
    });

    it("throws when custom field values are provided but no custom fields are configured", async () => {
      await expect(
        validateCustomFieldsForSection({
          customFieldValues: { cfd_unknown: "foo" },
          customFieldsModel: buildCustomFieldsModel([]),
          section: "feature",
        }),
      ).rejects.toThrow("No custom fields are available to be defined.");
    });

    it("throws when a required text field is missing from the payload", async () => {
      await expect(
        validate({
          values: undefined,
          fields: [
            buildCustomField({
              id: "cfd_summary",
              name: "Summary",
              type: "text",
              required: true,
            }),
          ],
        }),
      ).rejects.toThrow('Custom field "Summary" is required.');
    });

    it("throws when a required text field is only whitespace", async () => {
      await expect(
        validate({
          values: { cfd_summary: "   " },
          fields: [
            buildCustomField({
              id: "cfd_summary",
              name: "Summary",
              type: "text",
              required: true,
            }),
          ],
        }),
      ).rejects.toThrow('Custom field "cfd_summary" is required.');
    });

    it("throws when a required text field is an object payload", async () => {
      await expect(
        validate({
          values: {
            cfd_summary: { unexpected: "shape" },
          },
          fields: [
            buildCustomField({
              id: "cfd_summary",
              name: "Summary",
              type: "text",
              required: true,
            }),
          ],
        }),
      ).rejects.toThrow('Custom field "cfd_summary" is required.');
    });

    it("allows optional text fields to be empty", async () => {
      await expect(
        validate({
          values: { cfd_summary: "   " },
          fields: [
            buildCustomField({
              id: "cfd_summary",
              name: "Summary",
              type: "text",
              required: false,
            }),
          ],
        }),
      ).resolves.toBeUndefined();
    });

    it("throws when a required enum field is missing", async () => {
      await expect(
        validate({
          values: {},
          fields: [
            buildCustomField({
              id: "cfd_team",
              name: "Owning Team",
              type: "enum",
              required: true,
              values: "growth,platform",
            }),
          ],
        }),
      ).rejects.toThrow('Custom field "Owning Team" is required.');
    });

    it("throws when a required enum field is submitted as an empty string", async () => {
      await expect(
        validate({
          values: { cfd_team: "" },
          fields: [
            buildCustomField({
              id: "cfd_team",
              name: "Owning Team",
              type: "enum",
              required: true,
              values: "growth,platform",
            }),
          ],
        }),
      ).rejects.toThrow('Custom field "cfd_team" is required.');
    });

    it("allows optional enum fields to be empty", async () => {
      await expect(
        validate({
          values: { cfd_team: "" },
          fields: [
            buildCustomField({
              id: "cfd_team",
              name: "Owning Team",
              type: "enum",
              required: false,
              values: "growth,platform",
            }),
          ],
        }),
      ).resolves.toBeUndefined();
    });

    it("accepts enum values with extra whitespace", async () => {
      await expect(
        validate({
          values: { cfd_team: "  growth " },
          fields: [
            buildCustomField({
              id: "cfd_team",
              name: "Owning Team",
              type: "enum",
              required: true,
              values: "growth,platform",
            }),
          ],
        }),
      ).resolves.toBeUndefined();
    });

    it("accepts enum values sent as JSON arrays with one value", async () => {
      await expect(
        validate({
          values: { cfd_team: '["growth"]' },
          fields: [
            buildCustomField({
              id: "cfd_team",
              name: "Owning Team",
              type: "enum",
              required: true,
              values: "growth,platform",
            }),
          ],
        }),
      ).resolves.toBeUndefined();
    });

    it("rejects enum values sent as arrays with more than one value", async () => {
      await expect(
        validate({
          values: { cfd_team: '["growth","platform"]' },
          fields: [
            buildCustomField({
              id: "cfd_team",
              name: "Owning Team",
              type: "enum",
              required: true,
              values: "growth,platform",
            }),
          ],
        }),
      ).rejects.toThrow("Only one value is allowed for enum fields.");
    });

    it("throws when a required multiselect field is submitted as an empty array", async () => {
      await expect(
        validate({
          values: { cfd_owners: "[]" },
          fields: [
            buildCustomField({
              id: "cfd_owners",
              name: "Owners",
              type: "multiselect",
              required: true,
              values: "team-a,team-b",
              section: "experiment",
            }),
          ],
          section: "experiment",
        }),
      ).rejects.toThrow('Custom field "cfd_owners" is required.');
    });

    it("allows optional multiselect fields to be empty arrays", async () => {
      await expect(
        validate({
          values: { cfd_owners: "[]" },
          fields: [
            buildCustomField({
              id: "cfd_owners",
              name: "Owners",
              type: "multiselect",
              required: false,
              values: "team-a,team-b",
              section: "experiment",
            }),
          ],
          section: "experiment",
        }),
      ).resolves.toBeUndefined();
    });

    it("accepts multiselect JSON payloads used by the UI", async () => {
      await expect(
        validate({
          values: { cfd_owners: '["team-a","team-b"]' },
          fields: [
            buildCustomField({
              id: "cfd_owners",
              name: "Owners",
              type: "multiselect",
              required: true,
              values: "team-a,team-b",
              section: "experiment",
            }),
          ],
          section: "experiment",
        }),
      ).resolves.toBeUndefined();
    });

    it("accepts multiselect CSV payloads used by the API", async () => {
      await expect(
        validate({
          values: { cfd_owners: "team-a,team-b" },
          fields: [
            buildCustomField({
              id: "cfd_owners",
              name: "Owners",
              type: "multiselect",
              required: true,
              values: "team-a,team-b",
              section: "experiment",
            }),
          ],
          section: "experiment",
        }),
      ).resolves.toBeUndefined();
    });

    it("throws when a multiselect value is not in the allowed options", async () => {
      await expect(
        validate({
          values: { cfd_owners: '["team-c"]' },
          fields: [
            buildCustomField({
              id: "cfd_owners",
              name: "Owners",
              type: "multiselect",
              required: true,
              values: "team-a,team-b",
              section: "experiment",
            }),
          ],
          section: "experiment",
        }),
      ).rejects.toThrow(
        "Invalid multiselect value for custom field cfd_owners",
      );
    });

    it("treats numeric zero as a valid required number value", async () => {
      await expect(
        validate({
          values: { cfd_size: 0 },
          fields: [
            buildCustomField({
              id: "cfd_size",
              name: "Size",
              type: "number",
              required: true,
            }),
          ],
        }),
      ).resolves.toBeUndefined();
    });

    it("rejects required number values that are only whitespace", async () => {
      await expect(
        validate({
          values: { cfd_size: "   " },
          fields: [
            buildCustomField({
              id: "cfd_size",
              name: "Size",
              type: "number",
              required: true,
            }),
          ],
        }),
      ).rejects.toThrow('Custom field "cfd_size" is required.');
    });

    it("rejects invalid number values", async () => {
      await expect(
        validate({
          values: { cfd_size: "not-a-number" },
          fields: [
            buildCustomField({
              id: "cfd_size",
              name: "Size",
              type: "number",
              required: true,
            }),
          ],
        }),
      ).rejects.toThrow("Invalid number value for custom field cfd_size");
    });

    it("accepts valid numeric strings", async () => {
      await expect(
        validate({
          values: { cfd_size: "12.5" },
          fields: [
            buildCustomField({
              id: "cfd_size",
              name: "Size",
              type: "number",
              required: true,
            }),
          ],
        }),
      ).resolves.toBeUndefined();
    });

    it("accepts boolean false for required boolean fields", async () => {
      await expect(
        validate({
          values: { cfd_toggle: false },
          fields: [
            buildCustomField({
              id: "cfd_toggle",
              name: "Toggle",
              type: "boolean",
              required: true,
            }),
          ],
        }),
      ).resolves.toBeUndefined();
    });

    it("rejects invalid boolean strings", async () => {
      await expect(
        validate({
          values: { cfd_toggle: "yes" },
          fields: [
            buildCustomField({
              id: "cfd_toggle",
              name: "Toggle",
              type: "boolean",
              required: true,
            }),
          ],
        }),
      ).rejects.toThrow("Invalid boolean value for custom field cfd_toggle");
    });

    it("allows optional date fields to be empty", async () => {
      await expect(
        validate({
          values: { cfd_date: "   " },
          fields: [
            buildCustomField({
              id: "cfd_date",
              name: "Launch Date",
              type: "date",
              required: false,
            }),
          ],
        }),
      ).resolves.toBeUndefined();
    });

    it("rejects invalid datetime values", async () => {
      await expect(
        validate({
          values: { cfd_datetime: "not-a-date" },
          fields: [
            buildCustomField({
              id: "cfd_datetime",
              name: "Launch Time",
              type: "datetime",
              required: true,
            }),
          ],
        }),
      ).rejects.toThrow("Invalid datetime value for custom field cfd_datetime");
    });

    it("accepts valid url values", async () => {
      await expect(
        validate({
          values: { cfd_doc: "https://example.com/docs" },
          fields: [
            buildCustomField({
              id: "cfd_doc",
              name: "Documentation",
              type: "url",
              required: true,
            }),
          ],
        }),
      ).resolves.toBeUndefined();
    });

    it("rejects invalid url values", async () => {
      await expect(
        validate({
          values: { cfd_doc: "not-a-url" },
          fields: [
            buildCustomField({
              id: "cfd_doc",
              name: "Documentation",
              type: "url",
              required: true,
            }),
          ],
        }),
      ).rejects.toThrow("Invalid url value for custom field cfd_doc");
    });

    it("throws when a value references an unknown custom field key", async () => {
      await expect(
        validate({
          values: { cfd_unknown: "growth" },
          fields: [
            buildCustomField({
              id: "cfd_team",
              name: "Owning Team",
              type: "enum",
              values: "growth,platform",
            }),
          ],
        }),
      ).rejects.toThrow(
        "Invalid custom field: cfd_unknown. This custom field does not exist.",
      );
    });

    it("accepts valid required custom field values", async () => {
      await expect(
        validate({
          values: { cfd_team: "growth" },
          fields: [
            buildCustomField({
              id: "cfd_team",
              name: "Owning Team",
              type: "enum",
              required: true,
              values: "growth,platform",
            }),
          ],
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe("cross-path format compatibility", () => {
    it("accepts the same required multiselect value sent by UI and API formats", async () => {
      const field = buildCustomField({
        id: "cfd_owners",
        name: "Owners",
        type: "multiselect",
        required: true,
        values: "team-a,team-b",
      });

      await expect(
        validateCustomFieldsForSection({
          customFieldValues: { cfd_owners: '["team-a"]' },
          customFieldsModel: buildCustomFieldsModel([field]),
          section: "feature",
        }),
      ).resolves.toBeUndefined();

      await expect(
        validateCustomFieldsForSection({
          customFieldValues: { cfd_owners: "team-a" },
          customFieldsModel: buildCustomFieldsModel([field]),
          section: "feature",
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe("shouldValidateCustomFieldsOnUpdate", () => {
    it("returns false when customFields is omitted from the update payload", () => {
      expect(
        shouldValidateCustomFieldsOnUpdate({
          existingCustomFieldValues: { cfd_team: "growth" },
          updatedCustomFieldValues: undefined,
        }),
      ).toBe(false);
    });

    it("returns false when customFields payload is unchanged", () => {
      expect(
        shouldValidateCustomFieldsOnUpdate({
          existingCustomFieldValues: { cfd_team: "growth" },
          updatedCustomFieldValues: { cfd_team: "growth" },
        }),
      ).toBe(false);
    });

    it("returns true when customFields are changed", () => {
      expect(
        shouldValidateCustomFieldsOnUpdate({
          existingCustomFieldValues: { cfd_team: "growth" },
          updatedCustomFieldValues: {},
        }),
      ).toBe(true);
    });
  });
});
