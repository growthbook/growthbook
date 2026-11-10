import { useForm } from "react-hook-form";
import {
  SDKAttribute,
  SDKAttributeFormat,
  SDKAttributeType,
} from "shared/types/organization";
import { getDefaultProjectsForNewResource } from "shared/demo-datasource";
import { Flex } from "@radix-ui/themes";
import { useAttributeSchema } from "@/services/features";
import { useAttributeReferences } from "@/hooks/useAttributeReferences";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import MultiSelectField from "@/ui/MultiSelectField";
import { useUser } from "@/services/UserContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import useProjectOptions from "@/hooks/useProjectOptions";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import { validatedSubmit } from "@/ui/Modal/validatedSubmit";
import TextField from "@/ui/TextField";
import Text from "@/ui/Text";
import Link from "@/ui/Link";
import Callout from "@/ui/Callout";
import HelperText from "@/ui/HelperText";
import AttributeFormLayout, {
  AdvancedSettings,
  DescriptionField,
  RenameWarning,
  isSecureDatatype,
  STRING_FORMATS,
  StringFormatField,
  ATTRIBUTE_DATA_TYPES,
  DataTypeField,
  IDENTIFIER_DATA_TYPES,
} from "@/components/Features/AttributeFormLayout";
import TagsInput from "@/components/Tags/TagsInput";
import CustomFieldInput from "@/components/CustomFields/CustomFieldInput";
import AddAttributeSnippet from "@/components/SyntaxHighlighting/Snippets/AddAttributeSnippet";
import { useReconciledCustomFields } from "@/hooks/useReconciledCustomFields";
import AttributeReferencesList from "./AttributeReferencesList";

export interface Props {
  close: () => void;
  onSave?: (property: string) => void;
  attribute?: string;
  defaultHashAttribute?: boolean;
  defaultProjects?: string[];
  // Shown when adding, for attributes that should be identifiers instead.
  onAddIdentifier?: () => void;
}

const PLACEHOLDER_NAME = "country";

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
  onSave,
  attribute,
  defaultHashAttribute = false,
  defaultProjects,
  onAddIdentifier,
}: Props) {
  const { projects, project, datasources } = useDefinitions();
  const permissionsUtil = usePermissionsUtil();
  const { refreshOrganization } = useUser();
  const { apiCall, orgId } = useAuth();

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

  // Only describes the example value when the type alone doesn't.
  const snippetHelp =
    supportsEnumOptions && enumOptions.length
      ? `One of: ${enumOptions.join(", ")}`
      : datatype === "string"
        ? STRING_FORMATS.find((f) => f.value === format)?.label
        : undefined;

  return (
    <ModalStandard
      trackingEventModalType={attribute ? "edit-attribute" : "add-attribute"}
      open={true}
      close={close}
      header={attribute ? "Edit Attribute" : "Add Attribute"}
      cta={attribute ? "Save" : "Add Attribute"}
      size="xl"
      ctaEnabled={!!property.trim() && hasProjectPermission}
      submit={validatedSubmit(form, async (value) => {
        if (value.datatype !== "string") {
          value.format = "";
          value.disableEqualityConditions = false;
        }
        // Enum options are valid for scalar enums and list attributes; clear them otherwise.
        if (value.datatype !== "enum" && !value.datatype.endsWith("[]")) {
          value.enum = "";
        }
        if (!IDENTIFIER_DATA_TYPES.includes(value.datatype)) {
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
        // Awaited so a redirect to the renamed attribute finds it.
        await refreshOrganization();
        onSave?.(value.property);
      })}
    >
      <AttributeFormLayout
        panel={
          <Flex direction="column" gap="2">
            <AddAttributeSnippet
              property={property.trim() || PLACEHOLDER_NAME}
              value={exampleValue(datatype, format, enumOptions)}
              projects={selectedProjects}
              nested
            />
            {snippetHelp && (
              <Text size="sm" color="text-low">
                {snippetHelp}
              </Text>
            )}
          </Flex>
        }
      >
        {!attribute && onAddIdentifier && (
          <Callout status="info" dismissible id="add-attribute-identifier-hint">
            Using this to assign users in experiments or percentage rollouts?{" "}
            <Link onClick={onAddIdentifier}>Add an identifier</Link> instead.
          </Callout>
        )}
        {refCount > 0 && !constrainingChange && !propertyChanged && refs && (
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
          label="Name"
          autoComplete="off"
          data-1p-ignore
          required
          markRequired
          autoFocus={!attribute}
          placeholder="e.g. country"
          value={property}
          onChange={(e) => form.setValue("property", e.target.value)}
          helpText="Must match the key your SDK passes in."
        />
        {propertyChanged && (
          <RenameWarning
            references={refs}
            hasJsonManagedWarehouse={hasJsonManagedWarehouse}
            secure={isSecureDatatype(current?.datatype)}
          />
        )}

        <DescriptionField
          value={form.watch("description") || ""}
          setValue={(value) => form.setValue("description", value)}
          placeholder="What this value means, e.g. the visitor's country from an IP lookup"
        />

        <Flex direction="column" gap="2">
          <DataTypeField
            value={datatype}
            setValue={(v) => form.setValue("datatype", v)}
            options={ATTRIBUTE_DATA_TYPES}
          />
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
              <StringFormatField
                value={format}
                setValue={(v) => form.setValue("format", v)}
              />
            )}
            {supportsEnumOptions && (
              <TextField
                label={datatype === "enum" ? "Values" : "Allowed values"}
                required={datatype === "enum"}
                markRequired={datatype === "enum"}
                placeholder={
                  datatype === "number[]"
                    ? "e.g. 1, 2, 3"
                    : "e.g. free, pro, enterprise"
                }
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
              operator no longer offered — keep running but become hard to edit.
              <span style={{ display: "block", marginTop: "var(--space-2)" }}>
                The change is applied in place: no new attribute is created,
                existing conditions keep evaluating, and features are not
                updated automatically.
              </span>
            </Callout>
            {refCount > 0 && refs && !propertyChanged ? (
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
            size="md"
            legacyLabelFormatting={false}
            placeholder={
              canCreateWithoutProject ? "All Projects" : "Select projects..."
            }
            value={selectedProjects}
            options={projectOptions}
            onChange={(v) => form.setValue("projects", v)}
          />
        )}
        {!hasProjectPermission && (
          <HelperText status="error">
            {!selectedProjects.length && projectOptions.length > 0
              ? "Select a Project to continue."
              : `You don't have permission to ${
                  attribute ? "update" : "create"
                } attributes in these Projects.`}
          </HelperText>
        )}
        <TagsInput
          label="Tags"
          size="md"
          legacyLabelFormatting={false}
          value={form.watch("tags") || []}
          onChange={(tags) => form.setValue("tags", tags)}
          autoFocus={false}
        />
        {availableCustomFields.length > 0 && (
          <CustomFieldInput
            fields={availableCustomFields}
            mt="0"
            value={customFieldValues}
            onChange={(value) => form.setValue("customFields", value)}
          />
        )}

        {canDisableEquality && (
          <AdvancedSettings
            disableEqualityConditions={
              !!form.watch("disableEqualityConditions")
            }
            setDisableEqualityConditions={(value) =>
              form.setValue("disableEqualityConditions", value)
            }
          />
        )}
      </AttributeFormLayout>
    </ModalStandard>
  );
}
