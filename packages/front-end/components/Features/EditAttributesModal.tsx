import { useContext } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { SDKAttributeSchema } from "back-end/types/organization";
import { useAuth } from "../../services/auth";
import Modal from "../Modal";
import { UserContext } from "../ProtectedPage";

export default function EditAttributesModal({ close }: { close: () => void }) {
  const { settings, update } = useContext(UserContext);
  const { apiCall } = useAuth();

  const form = useForm<{ attributeSchema: SDKAttributeSchema }>({
    defaultValues: {
      attributeSchema: settings?.attributeSchema?.length
        ? settings?.attributeSchema
        : [
            { property: "id", datatype: "string" },
            { property: "loggedIn", datatype: "boolean" },
            { property: "deviceId", datatype: "string" },
            { property: "employee", datatype: "boolean" },
            { property: "company", datatype: "string" },
            { property: "country", datatype: "string" },
            { property: "browser", datatype: "string" },
            { property: "url", datatype: "string" },
          ],
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
        await apiCall(`/organization`, {
          method: "PUT",
          body: JSON.stringify({
            settings: value,
          }),
        });
        await update();
      })}
    >
      <label>Targeting Attributes</label>
      <div className="form-inline">
        <ul className="mb-1 pl-4">
          {attributeSchema.fields.map((v, i) => (
            <li key={i} className="mb-1">
              <input
                {...form.register(`attributeSchema.${i}.property`)}
                placeholder="Property Name"
                className="form-control"
                required
              />
              <select
                {...form.register(`attributeSchema.${i}.datatype`)}
                className="form-control ml-2"
              >
                <option value="boolean">Boolean</option>
                <option value="number">Number</option>
                <option value="string">String</option>
                <option value="number[]">Array of Numbers</option>
                <option value="string[]">Array of Strings</option>
              </select>
              <button
                className="btn btn-link text-danger"
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  attributeSchema.remove(i);
                }}
              >
                remove
              </button>
            </li>
          ))}
        </ul>
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
