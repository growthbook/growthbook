import { useState } from "react";
import { useForm } from "react-hook-form";
import {
  SDKAttribute,
  SDKAttributeFormat,
  SDKAttributeType,
} from "shared/types/organization";
import { getDefaultProjectsForNewResource } from "shared/demo-datasource";
import { FaExclamationCircle, FaInfoCircle } from "react-icons/fa";
import { PiCaretDown, PiCaretRight } from "react-icons/pi";
import { Box, Flex, Grid } from "@radix-ui/themes";
import { useAttributeSchema } from "@/services/features";
import { useAttributeReferences } from "@/hooks/useAttributeReferences";
import { useAuth } from "@/services/auth";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import { useDefinitions } from "@/services/DefinitionsContext";
import MultiSelectField from "@/ui/MultiSelectField";
import { useUser } from "@/services/UserContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import useProjectOptions from "@/hooks/useProjectOptions";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import TextField from "@/ui/TextField";
import Text from "@/ui/Text";
import Button from "@/ui/Button";
import Link from "@/ui/Link";
import Callout from "@/ui/Callout";
import Checkbox from "@/ui/Checkbox";
import { Select, SelectItem } from "@/ui/Select";
import MarkdownInput from "@/components/Markdown/MarkdownInput";
import TagsInput from "@/components/Tags/TagsInput";
import CustomFieldInput from "@/components/CustomFields/CustomFieldInput";
import AddAttributeSnippet from "@/components/SyntaxHighlighting/Snippets/AddAttributeSnippet";
import { useReconciledCustomFields } from "@/hooks/useReconciledCustomFields";
import AttributeReferencesList from "./AttributeReferencesList";
import SDKCapabilityWarning from "./SDKCapabilityWarning";

export interface Props {
  close: () => void;
  attribute?: string;
  defaultHashAttribute?: boolean;
  defaultProjects?: string[];
  // Shown when adding, for attributes that should be identifiers instead.
  onAddIdentifier?: () => void;
}

const PLACEHOLDER_NAME = "newAttribute";
const PANEL_WIDTH = 380;
// Select can't hold an empty value, so "no format" gets its own.
const NO_FORMAT = "none";

const DATA_TYPES: { value: SDKAttributeType; label: string; help: string }[] = [
  { value: "boolean", label: "Boolean", help: "true or false" },
  { value: "number", label: "Number", help: "Floats or integers" },
  { value: "string", label: "String", help: "Freeform text" },
  {
    value: "enum",
    label: "Enum",
    help: "For a small list of pre-defined values",
  },
  {
    value: "secureString",
    label: "Secure string",
    help: "Freeform text; values hashed before passing to the SDK",
  },
  {
    value: "number[]",
    label: "Array of numbers",
    help: "Useful for multiple numeric values",
  },
  {
    value: "string[]",
    label: "Array of strings",
    help: 'Useful for things like "tags"',
  },
  {
    value: "secureString[]",
    label: "Array of secure strings",
    help: "Useful for passing multiple values securely",
  },
];

const STRING_FORMATS: {
  value: SDKAttributeFormat;
  label: string;
  example: string;
}[] = [
  { value: "version", label: "Version string", example: "1.2.3" },
  { value: "date", label: "Date string (ISO)", example: "2026-01-31" },
  {
    value: "isoCountryCode",
    label: "ISO country code (2 digit)",
    example: "US",
  },
];

const HASH_ATTRIBUTE_DATA_TYPES: SDKAttributeType[] = [
  "string",
  "number",
  "secureString",
];

function exampleValue(
  datatype: SDKAttributeType,
  format: string,
  enumOptions: string[],
): unknown {
  switch (datatype) {
    case "boolean":
      return true;
    case "number":
      return 123;
    case "number[]":
      return [1, 2];
    case "enum":
      return enumOptions[0] ?? "foo";
    case "string[]":
    case "secureString[]":
      return enumOptions.length ? enumOptions.slice(0, 2) : ["foo", "bar"];
    case "string":
    case "secureString":
      return STRING_FORMATS.find((f) => f.value === format)?.example ?? "foo";
  }
}

export default function AttributeModal({
  close,
  attribute,
  defaultHashAttribute = false,
  defaultProjects,
  onAddIdentifier,
}: Props) {
  const { projects, project, datasources } = useDefinitions();
  const permissionsUtil = usePermissionsUtil();
  const { refreshOrganization } = useUser();
  const { apiCall, orgId } = useAuth();
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const schema = useAttributeSchema(true);
  const current = schema.find((s) => s.property === attribute);

  const form = useForm<SDKAttribute>({
    defaultValues: {
      property: attribute || "",
      description: current?.description || "",
      datatype: current?.datatype || "string",
      projects: attribute
        ? current?.projects || []
        : (defaultProjects ??
          getDefaultProjectsForNewResource({
            project,
            organizationId: orgId || undefined,
          })),
      format: ((current?.format as unknown) !== "none"
        ? current?.format || ""
        : "") as SDKAttributeFormat,
      enum: current?.enum || "",
      hashAttribute: attribute
        ? !!current?.hashAttribute
        : defaultHashAttribute,
      disableEqualityConditions: current?.disableEqualityConditions || false,
      tags: current?.tags || [],
      customFields: current?.customFields || {},
    },
  });

  const { availableFields: availableCustomFields, value: customFieldValues } =
    useReconciledCustomFields({
      section: "attribute",
      projects: form.watch("projects") || [],
      value: form.watch("customFields"),
      setValue: (value) => form.setValue("customFields", value),
    });

  const property = form.watch("property");
  const datatype = form.watch("datatype");
  const format = form.watch("format") || "";
  const enumValue = form.watch("enum") || "";
  const enumOptions = enumValue
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);

  // Attribute changes only affect warehouse analyses for JSON-column managed warehouses.
  const hasJsonManagedWarehouse = datasources.some(
    (d) => d.type === "growthbook_clickhouse" && d.settings.useJsonColumns,
  );
  const propertyChanged = !!attribute && property !== attribute;
  const datatypeChanged = !!attribute && datatype !== current?.datatype;

  const isArrayDatatype = datatype.endsWith("[]");
  // Enum options constrain both scalar enums and array (list) attributes.
  const supportsEnumOptions = datatype === "enum" || isArrayDatatype;
  const canDisableEquality = datatype === "string" && !format;

  // Constraining an in-use attribute (converting to enum or a restricted list, or tightening
  // its allowed values) restricts how existing conditions can be edited, so surface
  // where it's referenced as a heads-up. Fires on both datatype and enum-value edits.
  const isConstrainedType =
    datatype === "enum" || (isArrayDatatype && !!enumValue);
  const enumChanged = enumValue !== (current?.enum || "");
  const constrainingChange =
    !!attribute && isConstrainedType && (datatypeChanged || enumChanged);
  const { references } = useAttributeReferences(attribute ? [attribute] : []);
  const refs = attribute ? references?.[attribute] : undefined;
  const refCount = refs
    ? refs.features.length + refs.experiments.length + refs.savedGroups.length
    : 0;

  const permissionRequired = (project: string) => {
    return attribute
      ? permissionsUtil.canUpdateAttribute({ projects: [project] }, {})
      : permissionsUtil.canCreateAttribute({ projects: [project] });
  };

  const projectOptions = useProjectOptions(
    permissionRequired,
    form.watch("projects") || [],
  );

  const selectedProjects = form.watch("projects") || [];
  const canCreateWithoutProject = attribute
    ? permissionsUtil.canUpdateAttribute(
        { projects: current?.projects || [] },
        { projects: [] },
      )
    : permissionsUtil.canCreateAttribute({ projects: [] });
  const hasProjectPermission = attribute
    ? permissionsUtil.canUpdateAttribute(
        { projects: current?.projects || [] },
        { projects: selectedProjects },
      )
    : permissionsUtil.canCreateAttribute({ projects: selectedProjects });

  const snippetHelp =
    datatype === "enum" && enumOptions.length
      ? `One of: ${enumOptions.join(", ")}`
      : DATA_TYPES.find((d) => d.value === datatype)?.help;

  return (
    <ModalStandard
      trackingEventModalType={attribute ? "edit-attribute" : "add-attribute"}
      open={true}
      close={close}
      header={attribute ? "Edit Attribute" : "Add Attribute"}
      cta={attribute ? "Save" : "Add Attribute"}
      size="xl"
      ctaEnabled={!!property.trim()}
      submit={form.handleSubmit(async (value) => {
        if (!hasProjectPermission) {
          throw new Error(
            !selectedProjects.length && projectOptions.length > 0
              ? "Select a project to continue."
              : `You don't have permission to ${
                  attribute ? "update" : "create"
                } attributes.`,
          );
        }
        if (value.datatype !== "string") {
          value.format = "";
          value.disableEqualityConditions = false;
        }
        // Enum options are valid for scalar enums and list attributes; clear them otherwise.
        if (value.datatype !== "enum" && !value.datatype.endsWith("[]")) {
          value.enum = "";
        }
        if (!HASH_ATTRIBUTE_DATA_TYPES.includes(value.datatype)) {
          value.hashAttribute = false;
        }

        if (value.format) {
          value.disableEqualityConditions = false;
        }

        if (
          (!attribute || (attribute && value.property !== attribute)) &&
          schema.some((s) => s.property === value.property)
        ) {
          throw new Error(
            "That attribute name is already being used. Please choose another one.",
          );
        }

        const attributeObj: SDKAttribute & { previousName?: string } = {
          property: value.property,
          datatype: value.datatype,
          description: value.description,
          projects: value.projects,
          format: value.format,
          enum: value.enum,
          hashAttribute: value.hashAttribute,
          disableEqualityConditions: value.disableEqualityConditions,
          tags: value.tags,
          ...(availableCustomFields.length > 0 && {
            customFields: value.customFields,
          }),
        };

        // If the attribute name is changed, we need to pass in the original name
        // as that's how we access the attribute in the backend
        if (attribute && attribute !== value.property) {
          attributeObj.previousName = attribute;
        }

        await apiCall<{
          status: number;
        }>("/attribute", {
          method: attribute ? "PUT" : "POST",
          body: JSON.stringify(attributeObj),
        });
        refreshOrganization();
      })}
    >
      <Grid columns={`minmax(0, 1fr) ${PANEL_WIDTH}px`} gap="6">
        <Flex direction="column" gap="5" style={{ minWidth: 0 }}>
          {refCount > 0 && !constrainingChange && refs && (
            <Callout status="info">
              Used by{" "}
              {new Intl.ListFormat("en").format(
                [
                  [refs.features.length, "Feature Flag"],
                  [refs.experiments.length, "experiment"],
                  [refs.savedGroups.length, "Saved Group"],
                ]
                  .filter(([count]) => count)
                  .map(
                    ([count, noun]) =>
                      `${count} ${noun}${count === 1 ? "" : "s"}`,
                  ),
              )}
              .
            </Callout>
          )}

          <TextField
            label="Attribute"
            required
            markRequired
            autoFocus={!attribute}
            placeholder={PLACEHOLDER_NAME}
            value={property}
            onChange={(e) => form.setValue("property", e.target.value)}
            helpText="Must match the key your SDK passes in."
          />
          {propertyChanged ? (
            <Callout status="warning">
              Be careful changing the attribute name. Any existing targeting
              conditions that use this attribute will NOT be updated
              automatically and will still reference the old attribute name.
              {hasJsonManagedWarehouse ? (
                <span style={{ display: "block", marginTop: "var(--space-2)" }}>
                  Renaming doesn&apos;t migrate historical data. Events already
                  sent under the old name keep that name in the Managed
                  Warehouse and will read as null for this attribute; only
                  events your SDK sends under the new name will populate it
                  going forward.
                </span>
              ) : null}
            </Callout>
          ) : null}

          <Flex direction="column" gap="2">
            <Text weight="medium">Description</Text>
            <MarkdownInput
              value={form.watch("description") || ""}
              setValue={(value) => form.setValue("description", value)}
            />
          </Flex>

          <Flex direction="column" gap="2">
            <Select
              label="Data type"
              value={datatype}
              setValue={(v) =>
                form.setValue(
                  "datatype",
                  DATA_TYPES.find((d) => d.value === v)?.value ?? "string",
                )
              }
            >
              {DATA_TYPES.map((d) => (
                <SelectItem key={d.value} value={d.value}>
                  {d.label}
                </SelectItem>
              ))}
            </Select>
            <Text size="sm" color="text-low">
              {DATA_TYPES.find((d) => d.value === datatype)?.help}
            </Text>
            {["secureString", "secureString[]"].includes(datatype) && (
              <Text size="sm" color="text-low">
                <PremiumTooltip
                  commercialFeature="hash-secure-attributes"
                  tipPosition="bottom"
                  body={
                    <>
                      <p>
                        Feature targeting conditions referencing{" "}
                        <code>secureString</code> attributes will be anonymized
                        via SHA-256 hashing. When evaluating feature flags in a
                        public or insecure environment (such as a browser),
                        hashing provides an additional layer of security through
                        obfuscation. This allows you to target users based on
                        sensitive attributes.
                      </p>
                      <p>
                        You must enable this feature in your SDK Connection for
                        it to take effect.
                      </p>
                      <p className="mb-0 text-warning-orange small">
                        <FaExclamationCircle /> When using an insecure
                        environment, do not rely exclusively on hashing as a
                        means of securing highly sensitive data. Hashing is an
                        obfuscation technique that makes it very difficult, but
                        not impossible, to extract sensitive data.
                      </p>
                    </>
                  }
                >
                  How do secure attributes work? <FaInfoCircle />
                </PremiumTooltip>
              </Text>
            )}
          </Flex>
          {hasJsonManagedWarehouse && datatypeChanged ? (
            <Callout status="info">
              Changing the data type won&apos;t break existing Managed Warehouse
              analyses, but historical events whose value doesn&apos;t match the
              new type are treated as null and dropped from results, so metrics
              may shift.
            </Callout>
          ) : null}

          {(datatype === "string" || supportsEnumOptions) && (
            <Flex
              direction="column"
              gap="4"
              pl="4"
              style={{ borderLeft: "2px solid var(--gray-a5)" }}
            >
              {datatype === "string" && (
                <Flex direction="column" gap="2">
                  <Select
                    label="String format"
                    value={format || NO_FORMAT}
                    setValue={(v) =>
                      form.setValue(
                        "format",
                        STRING_FORMATS.find((f) => f.value === v)?.value ?? "",
                      )
                    }
                  >
                    <SelectItem value={NO_FORMAT}>None</SelectItem>
                    {STRING_FORMATS.map((f) => (
                      <SelectItem key={f.value} value={f.value}>
                        {f.label}
                      </SelectItem>
                    ))}
                  </Select>
                  <Text size="sm" color="text-low">
                    Changes the targeting UI and string comparison logic.
                  </Text>
                  {format === "version" && (
                    <SDKCapabilityWarning
                      capability="semverTargeting"
                      someMessage="Some of your SDK Connections do not support version string comparisons. Targeting conditions using this attribute may not work correctly for those connections."
                      noneMessage="None of your SDK Connections support version string comparisons. Do not use this format as it will break targeting conditions based on this attribute."
                    />
                  )}
                </Flex>
              )}
              {supportsEnumOptions && (
                <TextField
                  label={datatype === "enum" ? "Values" : "Allowed values"}
                  required={datatype === "enum"}
                  markRequired={datatype === "enum"}
                  value={enumValue}
                  onChange={(e) => form.setValue("enum", e.target.value)}
                  helpText={
                    datatype === "enum"
                      ? "Comma-separated."
                      : "Optional. Restrict this list to a fixed set of comma-separated values. Leave blank to allow any values."
                  }
                />
              )}
            </Flex>
          )}
          {constrainingChange ? (
            <>
              <Callout status="warning">
                <strong>
                  Include every value already used in targeting before saving.
                </strong>{" "}
                Conditions referencing a value outside the list — or using an
                operator no longer offered — keep running but become hard to
                edit.
                <span style={{ display: "block", marginTop: "var(--space-2)" }}>
                  The change is applied in place: no new attribute is created,
                  existing conditions keep evaluating, and features are not
                  updated automatically.
                </span>
              </Callout>
              {refCount > 0 && refs ? (
                <AttributeReferencesList
                  features={refs.features}
                  experiments={refs.experiments}
                  conditionGroups={refs.savedGroups}
                />
              ) : null}
            </>
          ) : null}

          {projects?.length > 0 && (
            <MultiSelectField
              label="Projects"
              placeholder={
                canCreateWithoutProject ? "All Projects" : "Select projects..."
              }
              value={selectedProjects}
              options={projectOptions}
              onChange={(v) => form.setValue("projects", v)}
            />
          )}
          <TagsInput
            label="Tags"
            value={form.watch("tags") || []}
            onChange={(tags) => form.setValue("tags", tags)}
            autoFocus={false}
          />
          {availableCustomFields.length > 0 && (
            <CustomFieldInput
              fields={availableCustomFields}
              value={customFieldValues}
              onChange={(value) => form.setValue("customFields", value)}
            />
          )}

          {canDisableEquality && (
            <Flex direction="column" gap="3">
              <Box>
                <Button
                  variant="ghost"
                  icon={advancedOpen ? <PiCaretDown /> : <PiCaretRight />}
                  aria-expanded={advancedOpen}
                  onClick={() => setAdvancedOpen((open) => !open)}
                >
                  Advanced
                </Button>
              </Box>
              {advancedOpen && (
                <Flex direction="column" gap="3">
                  {canDisableEquality && (
                    <Checkbox
                      label="Disable equality comparisons"
                      description="This prevents users from targeting with exact string matches. Only regex and less than/greater than will be allowed. Useful for PII."
                      value={!!form.watch("disableEqualityConditions")}
                      setValue={(value) =>
                        form.setValue("disableEqualityConditions", value)
                      }
                    />
                  )}
                </Flex>
              )}
            </Flex>
          )}

          {!attribute && onAddIdentifier && (
            <Callout status="info">
              Using this attribute to split traffic?{" "}
              <Link onClick={onAddIdentifier}>Add it as an identifier</Link>{" "}
              instead.
            </Callout>
          )}
        </Flex>

        <Flex
          direction="column"
          gap="2"
          p="4"
          style={{
            alignSelf: "start",
            minWidth: 0,
            background: "var(--gray-a2)",
            border: "1px solid var(--gray-a4)",
            borderRadius: "var(--radius-3)",
          }}
        >
          <AddAttributeSnippet
            property={property.trim() || PLACEHOLDER_NAME}
            value={exampleValue(datatype, format, enumOptions)}
            projects={selectedProjects}
          />
          {snippetHelp && (
            <Text size="sm" color="text-low">
              {snippetHelp}
            </Text>
          )}
        </Flex>
      </Grid>
    </ModalStandard>
  );
}
