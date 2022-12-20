import { useFieldArray, useForm } from "react-hook-form";
import {
  SDKAttributeSchema,
  SDKAttributeType,
} from "back-end/types/organization";
import { FaQuestionCircle, FaTrash } from "react-icons/fa";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import track from "@/services/track";
import { useAttributeSchema } from "@/services/features";
import useOrgSettings from "@/hooks/useOrgSettings";
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
      {!settings?.attributeSchema?.length && (
        <p>
          We&apos;ve started you off with some common attributes, but feel free
          to modify the list as needed.
        </p>
      )}
      <div className="form-inline">
        <table className="table table-sm">
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
                    style={{ width: 200 }}
                    options={[
                      { value: "boolean", label: "Boolean" },
                      { value: "number", label: "Number" },
                      { value: "string", label: "String" },
                      { value: "enum", label: "Enum" },
                      { value: "number[]", label: "Array of Numbers" },
                      { value: "string[]", label: "Array of Strings" },
                    ]}
                  />
                  {form.watch(`attributeSchema.${i}.datatype`) === "enum" && (
                    <div>
                      <Field
                        textarea
                        minRows={1}
                        style={{ width: 200 }}
                        required
                        {...form.register(`attributeSchema.${i}.enum`)}
                        placeholder="Comma-separated list of all possible values"
                      />
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
      <div>
        <a
          href="#"
          className="btn btn-outline-primary"
          onClick={(e) => {
            e.preventDefault();
            attributeSchema.append({
              property: "",
              datatype: "string",
            });
          }}
        >
          add attribute
        </a>
      </div>
    </Modal>
  );
}
