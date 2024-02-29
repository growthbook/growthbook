import { useForm } from "react-hook-form";
import {
  OrganizationSettings,
  SDKAttribute,
  SDKAttributeFormat,
  SDKAttributeType,
} from "back-end/types/organization";
import { FaExclamationCircle, FaInfoCircle } from "react-icons/fa";
import { useAttributeSchema } from "@/services/features";
import { useUser } from "@/services/UserContext";
import { useAuth } from "@/services/auth";
import Modal from "@/components/Modal";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import Toggle from "@/components/Forms/Toggle";
import { useDefinitions } from "@/services/DefinitionsContext";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import Tooltip from "@/components/Tooltip/Tooltip";

export interface Props {
  close: () => void;
  attribute?: string;
}

export default function AttributeModal({ close, attribute }: Props) {
  const { refreshOrganization } = useUser();
  const { projects, project } = useDefinitions();

  const { apiCall } = useAuth();

  const schema = useAttributeSchema(true);
  const current = schema.find((s) => s.property === attribute);

  const form = useForm<SDKAttribute>({
    defaultValues: {
      property: attribute || "",
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

        const attributeSchema = [...schema];

        // Editing
        if (attribute) {
          const i = schema.findIndex((s) => s.property === attribute);
          if (i >= 0) {
            attributeSchema[i] = value;
          } else {
            attributeSchema.push(value);
          }
        }
        // Creating
        else {
          attributeSchema.push(value);
        }

        // Make sure this attribute name doesn't conflict with any existing attributes
        if (
          attributeSchema.filter((s) => s.property === value.property).length >
          1
        ) {
          throw new Error(
            "That attribute name is already being used. Please choose another one."
          );
        }

        const settings: Pick<OrganizationSettings, "attributeSchema"> = {
          attributeSchema,
        };
        await apiCall(`/organization`, {
          method: "PUT",
          body: JSON.stringify({
            settings,
          }),
        });

        refreshOrganization();
      })}
    >
      <Tooltip
        shouldDisplay={!!attribute}
        body="The attribute name cannot be changed after creation. If you need to change the name, you will need to create a new attribute and delete the old one."
      >
        <Field
          label="Attribute"
          {...form.register("property")}
          disabled={!!attribute}
        />
      </Tooltip>
      {projects?.length > 0 && (
        <div className="form-group">
          <MultiSelectField
            label="Projects"
            placeholder="All projects"
            value={form.watch("projects") || []}
            options={projects.map((p) => ({ value: p.id, label: p.name }))}
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
            options={[{ value: "version", label: "Version string" }]}
            sort={false}
            helpText="Affects the targeting attribute UI and string comparison logic. More formats coming soon."
          />
          {form.watch("format") === "version" && (
            <div className="alert alert-warning">
              <strong>Warning:</strong> Version string attributes are only
              supported in the latest Javascript and React SDK versions. Other
              language support is coming soon. Do not use this format if you are
              using an older SDK version or a different language as it will
              break any filtering based on the attribute.
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
