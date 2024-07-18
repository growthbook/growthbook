import { useForm } from "react-hook-form";
import {
  SDKAttribute,
  SDKAttributeFormat,
  SDKAttributeType,
} from "back-end/types/organization";
import { FaExclamationCircle, FaInfoCircle } from "react-icons/fa";
import React from "react";
import { useAttributeSchema } from "@/services/features";
import { useAuth } from "@/services/auth";
import Modal from "@/components/Modal";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import Toggle from "@/components/Forms/Toggle";
import { useDefinitions } from "@/services/DefinitionsContext";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import { useUser } from "@/services/UserContext";
import Tooltip from "@/components/Tooltip/Tooltip";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import useProjectOptions from "@/hooks/useProjectOptions";
import MinSDKVersionsList from "./MinSDKVersionsList";

export interface Props {
  close: () => void;
  attribute?: string;
}

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
      format: current?.format || "",
      enum: current?.enum || "",
      hashAttribute: !!current?.hashAttribute,
    },
  });

  const title = attribute ? `Edit Attribute: ${attribute}` : `Create Attribute`;

  const datatype = form.watch("datatype");

  const hashAttributeDataTypes: SDKAttributeType[] = [
    "string",
    "number",
    "secureString",
  ];

  const permissionRequired = attribute
    ? (project: string) =>
        permissionsUtil.canUpdateAttribute({ projects: [project] }, {})
    : (project: string) =>
        permissionsUtil.canCreateAttribute({ projects: [project] });

  const projectOptions = useProjectOptions(
    permissionRequired,
    form.watch("projects") || []
  );

  return (
    <Modal
      open={true}
      close={close}
      header={title}
      cta="Save"
      submit={form.handleSubmit(async (value) => {
        if (value.datatype !== "string") {
          value.format = "";
        }
        if (value.datatype !== "enum") {
          value.enum = "";
        }
        if (!hashAttributeDataTypes.includes(value.datatype)) {
          value.hashAttribute = false;
        }

        if (
          (!attribute || (attribute && value.property !== attribute)) &&
          schema.some((s) => s.property === value.property)
        ) {
          throw new Error(
            "That attribute name is already being used. Please choose another one."
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
      {projects?.length > 0 && (
        <div className="form-group">
          <MultiSelectField
            label="Projects"
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
            value={form.watch(`format`) || "none"}
            onChange={(v) => form.setValue(`format`, v as SDKAttributeFormat)}
            initialOption="None"
            options={[
              { value: "version", label: "Version string" },
              { value: "date", label: "Date string" },
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
        <div className="form-group">
          <label>Unique Identifier</label>
          <div className="row align-items-center">
            <div className="col-auto">
              <Toggle
                id={"hashAttributeToggle"}
                value={!!form.watch(`hashAttribute`)}
                setValue={(value) => {
                  form.setValue(`hashAttribute`, value);
                }}
              />
            </div>
            <div className="col px-0 text-muted" style={{ lineHeight: "1rem" }}>
              <div>Attribute can be used for user assignment</div>
              <small>
                For example, <code>email</code> or <code>id</code>
              </small>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
