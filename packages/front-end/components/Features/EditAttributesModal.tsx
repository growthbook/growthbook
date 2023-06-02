import { useFieldArray, useForm } from "react-hook-form";
import {
  SDKAttributeFormat,
  SDKAttributeSchema,
  SDKAttributeType,
} from "back-end/types/organization";
import {
  FaExclamationCircle,
  FaInfoCircle,
  FaQuestionCircle,
  FaTrash,
} from "react-icons/fa";
import React from "react";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import track from "@/services/track";
import { useAttributeSchema } from "@/services/features";
import useOrgSettings from "@/hooks/useOrgSettings";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import { GBAddCircle } from "@/components/Icons";
import Modal from "../Modal";
import Toggle from "../Forms/Toggle";
import Field from "../Forms/Field";
import Tooltip from "../Tooltip/Tooltip";
import SelectField from "../Forms/SelectField";

export default function EditAttributesModal({ close }: { close: () => void }) {
  const { refreshOrganization } = useUser();
  const settings = useOrgSettings();
  const { apiCall } = useAuth();

  const form = useForm<{ attributeSchema: SDKAttributeSchema }>({
    defaultValues: {
      attributeSchema: useAttributeSchema(true),
    },
  });

  const attributeSchema = useFieldArray({
    control: form.control,
    name: "attributeSchema",
  });

  return (
    <Modal
      close={close}
      header="Edit Targeting Attributes"
      open={true}
      size="lg"
      cta="Save Attributes"
      submit={form.handleSubmit(async (value) => {
        if (!settings?.attributeSchema) {
          track("Save Targeting Attributes", {
            source: "onboarding",
            hashAttributes: value.attributeSchema
              .filter((s) => s.hashAttribute)
              .map((s) => s.property),
          });
        }

        await apiCall(`/organization`, {
          method: "PUT",
          body: JSON.stringify({
            settings: value,
          }),
        });
        await refreshOrganization();
      })}
    >
      <p>
        The Attributes you define here can be used to create advanced targeting
        rules for features and to run experiments.
      </p>
      <div className="alert alert-warning">
        Version string attributes are only supported in the latest Javascript
        and React SDK versions. Other languages are coming soon.
      </div>
      {!settings?.attributeSchema?.length && (
        <p>
          We&apos;ve started you off with some common attributes, but feel free
          to modify the list as needed.
        </p>
      )}
      <div className="form-inline">
        <table className="table table-sm mb-0">
          <thead>
            <tr>
              <th>Attribute</th>
              <th>Data Type</th>
              <th>
                Identifier{" "}
                <Tooltip body="Any attribute that uniquely identifies a user, account, device, or similar.">
                  <FaQuestionCircle />
                </Tooltip>
              </th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {attributeSchema.fields.map((v, i) => (
              <tr
                className={
                  form.watch(`attributeSchema.${i}.archived`) ? "disabled" : ""
                }
                key={i}
              >
                <td>
                  <input
                    {...form.register(`attributeSchema.${i}.property`)}
                    placeholder="Property Name"
                    className="form-control"
                    required
                  />
                </td>
                <td>
                  <SelectField
                    value={form.watch(`attributeSchema.${i}.datatype`)}
                    onChange={(v) =>
                      form.setValue(
                        `attributeSchema.${i}.datatype`,
                        v as SDKAttributeType
                      )
                    }
                    style={{ width: 225 }}
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
                    sort={false}
                  />
                  {form.watch(`attributeSchema.${i}.datatype`) === "string" && (
                    <div className="my-1">
                      <SelectField
                        value={
                          form.watch(`attributeSchema.${i}.format`) || "none"
                        }
                        onChange={(v) =>
                          form.setValue(
                            `attributeSchema.${i}.format`,
                            v as SDKAttributeFormat
                          )
                        }
                        style={{ width: 225 }}
                        options={[
                          { value: "none", label: "Any format" },
                          { value: "version", label: "Version string" },
                        ]}
                        sort={false}
                      />
                    </div>
                  )}
                  {form.watch(`attributeSchema.${i}.datatype`) === "enum" && (
                    <div>
                      <Field
                        textarea
                        minRows={1}
                        style={{ width: 225 }}
                        required
                        {...form.register(`attributeSchema.${i}.enum`)}
                        placeholder="Comma-separated list of all possible values"
                      />
                    </div>
                  )}
                  {["secureString", "secureString[]"].includes(
                    form.watch(`attributeSchema.${i}.datatype`)
                  ) && (
                    <div
                      className="text-muted text-right"
                      style={{ width: 185 }}
                    >
                      <PremiumTooltip
                        commercialFeature="hash-secure-attributes"
                        innerClassName="text-left"
                        tipPosition="bottom"
                        body={
                          <>
                            <p>
                              Feature targeting conditions referencing{" "}
                              <code>secureString</code> attributes will be
                              anonymized via SHA-256 hashing. When evaluating
                              feature flags in a public or insecure environment
                              (such as a browser), hashing provides an
                              additional layer of security through obfuscation.
                              This allows you to target users based on sensitive
                              attributes.
                            </p>
                            <p>
                              You must enable this feature in your SDK
                              Connection for it to take effect.
                            </p>
                            <p className="mb-0 text-warning-orange small">
                              <FaExclamationCircle /> When using an insecure
                              environment, do not rely exclusively on hashing as
                              a means of securing highly sensitive data. Hashing
                              is an obfuscation technique that makes it very
                              difficult, but not impossible, to extract
                              sensitive data.
                            </p>
                          </>
                        }
                      >
                        What is this? <FaInfoCircle />
                      </PremiumTooltip>
                    </div>
                  )}
                </td>
                <td>
                  <Toggle
                    id={"toggle" + i}
                    label="Identifier"
                    style={{ marginTop: 5 }}
                    value={!!form.watch(`attributeSchema.${i}.hashAttribute`)}
                    setValue={(value) => {
                      form.setValue(
                        `attributeSchema.${i}.hashAttribute`,
                        value
                      );
                    }}
                  />
                </td>
                <td>
                  <button
                    className="btn btn-link text-danger close"
                    style={{ marginTop: 5 }}
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      attributeSchema.remove(i);
                    }}
                  >
                    <FaTrash />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2">
        <button
          className="btn btn-link mt-0"
          onClick={(e) => {
            e.preventDefault();
            attributeSchema.append({
              property: "",
              datatype: "string",
            });
          }}
        >
          <GBAddCircle /> Add attribute
        </button>
      </div>
    </Modal>
  );
}
