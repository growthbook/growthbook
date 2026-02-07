import { useForm } from "react-hook-form";
import {
  SDKAttribute,
  SDKAttributeFormat,
  SDKAttributeType,
} from "shared/types/organization";
import { FaExclamationCircle, FaInfoCircle } from "react-icons/fa";
import React from "react";
import { useAttributeSchema } from "@/services/features";
import { useAuth } from "@/services/auth";
import Modal from "@/components/Modal";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import { useDefinitions } from "@/services/DefinitionsContext";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import { useUser } from "@/services/UserContext";
import Tooltip from "@/components/Tooltip/Tooltip";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import useProjectOptions from "@/hooks/useProjectOptions";
import Checkbox from "@/ui/Checkbox";
import MinSDKVersionsList from "./MinSDKVersionsList";
import TagsField from "./FeatureModal/TagsField";

export interface Props {
  close: () => void;
  attribute?: string;
}

const DATA_TYPE_TO_DESCRIPTION: Record<SDKAttributeType, string> = {
  boolean: "true or false",
  number: "Floats or integers",
  string: "Freeform text",
  enum: "For a small list of pre-defined values",
  secureString: "Freeform text; values hashed before passing to the SDK",
  "number[]": "Useful for multiple numeric values",
  "string[]": 'Useful for things like "tags"',
  "secureString[]": "Useful for passing multiple values securely",
};
export default function AttributeModal({ close, attribute }: Props) {
  const { projects, project } = useDefinitions();
  const permissionsUtil = usePermissionsUtil();
  const { refreshOrganization } = useUser();

  const { apiCall } = useAuth();

  const schema = useAttributeSchema(true);
  const current = schema.find((s) => s.property === attribute);

  const form = useForm<SDKAttribute>({
    defaultValues: {
      property: attribute || "",
      description: current?.description || "",
      datatype: current?.datatype || "string",
      projects: attribute ? current?.projects || [] : project ? [project] : [],
      format: ((current?.format as unknown) !== "none"
        ? current?.format || ""
        : "") as SDKAttributeFormat,
      enum: current?.enum || "",
      hashAttribute: !!current?.hashAttribute,
      disableEqualityConditions: current?.disableEqualityConditions || false,
      tags: current?.tags || [],
    },
  });

  const title = attribute ? `Edit Attribute: ${attribute}` : `Create Attribute`;

  const datatype = form.watch("datatype");

  const hashAttributeDataTypes: SDKAttributeType[] = [
    "string",
    "number",
    "secureString",
  ];

  const permissionRequired = (project: string) => {
    return attribute
      ? permissionsUtil.canUpdateAttribute({ projects: [project] }, {})
      : permissionsUtil.canCreateAttribute({ projects: [project] });
  };

  const projectOptions = useProjectOptions(
    permissionRequired,
    form.watch("projects") || [],
  );

  return (
    <Modal
      trackingEventModalType=""
      open={true}
      close={close}
      header={title}
      cta="Save"
      submit={form.handleSubmit(async (value) => {
        if (value.datatype !== "string") {
          value.format = "";
          value.disableEqualityConditions = false;
        }
        if (value.datatype !== "enum") {
          value.enum = "";
        }
        if (!hashAttributeDataTypes.includes(value.datatype)) {
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
      <Field
        label={
          <>
            Attribute{" "}
            <Tooltip body={"This is the attribute name used in the SDK"} />
          </>
        }
        required={true}
        {...form.register("property")}
      />
      {attribute && form.watch("property") !== attribute ? (
        <div className="alert alert-warning">
          Be careful changing the attribute name. Any existing targeting
          conditions that use this attribute will NOT be updated automatically
          and will still reference the old attribute name.
        </div>
      ) : null}
      <div className="form-group">
        <Field
          className="form-control"
          label={
            <>
              Description <small className="text-muted">(optional)</small>
            </>
          }
          {...form.register("description")}
          textarea={true}
        />
      </div>
      <TagsField
        value={form.watch("tags") || []}
        onChange={(tags) => form.setValue("tags", tags)}
      />
      {projects?.length > 0 && (
        <div className="form-group">
          <MultiSelectField
            label={
              <>
                Projects{" "}
                <Tooltip
                  body={`The dropdown below has been filtered to only include projects where you have permission to ${
                    attribute ? "update" : "create"
                  } Attributes.`}
                />
              </>
            }
            placeholder="All projects"
            value={form.watch("projects") || []}
            options={projectOptions}
            onChange={(v) => form.setValue("projects", v)}
            customClassName="label-overflow-ellipsis"
            helpText="Assign this attribute to specific projects"
          />
        </div>
      )}
      <SelectField
        label="Data Type"
        value={datatype}
        onChange={(datatype: SDKAttributeType) =>
          form.setValue("datatype", datatype)
        }
        sort={false}
        options={[
          { value: "boolean", label: "Boolean" },
          { value: "number", label: "Number" },
          { value: "string", label: "String" },
          { value: "enum", label: "Enum" },
          { value: "secureString", label: "Secure String" },
          { value: "number[]", label: "Array of Numbers" },
          { value: "string[]", label: "Array of Strings" },
          {
            value: "secureString[]",
            label: "Array of Secure Strings",
          },
        ]}
        formatOptionLabel={(value) => {
          return (
            <div className="d-flex">
              <span className="pr-2">{value.label}</span>
              <span className="ml-auto text-muted">
                {DATA_TYPE_TO_DESCRIPTION[value.value]}
              </span>
            </div>
          );
        }}
        helpText={
          <>
            {["secureString", "secureString[]"].includes(datatype) && (
              <div className="text-muted">
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
              </div>
            )}
          </>
        }
      />
      {datatype === "string" && (
        <>
          <SelectField
            label="String Format"
            value={form.watch(`format`) || ""}
            onChange={(v) => form.setValue(`format`, v as SDKAttributeFormat)}
            initialOption="None"
            options={[
              { value: "version", label: "Version string" },
              { value: "date", label: "Date string (ISO)" },
              { value: "isoCountryCode", label: "ISO Country Code (2 digit)" },
            ]}
            sort={false}
            helpText="Affects the targeting attribute UI and string comparison logic. More formats coming soon."
          />
          {form.watch("format") === "version" && (
            <div className="alert alert-warning">
              <strong>Warning:</strong> Version string attributes are only
              supported in{" "}
              <Tooltip
                body={<MinSDKVersionsList capability="semverTargeting" />}
              >
                <span className="text-primary">some SDK versions</span>
              </Tooltip>
              . Do not use this format if you are using an incompatible SDK as
              it will break any filtering based on the attribute.
            </div>
          )}

          {!form.watch("format") && (
            <Checkbox
              label="Disable Equality Comparisons"
              description="This prevents users from targeting with exact string matches. Only regex and less than/greater than will be allowed. Useful for PII."
              value={!!form.watch(`disableEqualityConditions`)}
              setValue={(value) =>
                form.setValue(`disableEqualityConditions`, value)
              }
              mb="4"
            />
          )}
        </>
      )}
      {datatype === "enum" && (
        <Field
          label="Enum Options"
          textarea
          minRows={1}
          required
          {...form.register(`enum`)}
          helpText="Comma-separated list of all possible values"
        />
      )}
      {hashAttributeDataTypes.includes(datatype) && (
        <Checkbox
          label="Unique Identifier"
          description="Allow attribute to be used for experiment assignment."
          value={!!form.watch(`hashAttribute`)}
          setValue={(value) => form.setValue(`hashAttribute`, value)}
        />
      )}
    </Modal>
  );
}
