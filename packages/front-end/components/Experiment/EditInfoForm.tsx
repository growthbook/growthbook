import { FC, useContext } from "react";
import { FaPlus, FaTrash } from "react-icons/fa";
import { useFieldArray, useForm } from "react-hook-form";
import { useAuth } from "../../services/auth";
import {
  ExperimentInterfaceStringDates,
  ImplementationType,
} from "back-end/types/experiment";
import MarkdownInput from "../Markdown/MarkdownInput";
import Modal from "../Modal";
import dJSON from "dirty-json";
import { useDefinitions } from "../../services/DefinitionsContext";
import { UserContext } from "../ProtectedPage";
import RadioSelector from "../Forms/RadioSelector";
import Field from "../Forms/Field";

const EditInfoForm: FC<{
  experiment: ExperimentInterfaceStringDates;
  cancel: () => void;
  mutate: () => void;
}> = ({ experiment, cancel, mutate }) => {
  const {
    settings: { visualEditorEnabled },
  } = useContext(UserContext);

  const { getDatasourceById } = useDefinitions();
  const form = useForm<Partial<ExperimentInterfaceStringDates>>({
    defaultValues: {
      name: experiment.name || "",
      implementation: experiment.implementation || "code",
      hypothesis: experiment.hypothesis || "",
      description: experiment.description || experiment.observations || "",
      variations: experiment.variations
        ? experiment.variations.map((v) => {
            return {
              name: "",
              description: "",
              value: "",
              key: "",
              ...v,
            };
          })
        : [
            {
              name: "Control",
              value: "",
              description: "",
              key: "",
              screenshots: [],
            },
            {
              name: "Variation",
              description: "",
              value: "",
              key: "",
              screenshots: [],
            },
          ],
    },
  });
  const { apiCall } = useAuth();

  const variations = useFieldArray({
    control: form.control,
    name: "variations",
  });

  const implementation = form.watch("implementation");

  const datasource = getDatasourceById(experiment.datasource);
  const variationKeys =
    (datasource?.settings?.variationIdFormat ||
      datasource?.settings?.experiments?.variationFormat) === "key";

  return (
    <Modal
      header={"Edit Info"}
      open={true}
      close={cancel}
      size="lg"
      submit={form.handleSubmit(async (value) => {
        const data = { ...value };
        data.variations = [...data.variations];

        value.variations.forEach((v, i) => {
          if (v.value) {
            try {
              data.variations[i] = {
                ...data.variations[i],
                value: JSON.stringify(dJSON.parse(v.value), null, 2),
              };
            } catch (e) {
              throw new Error(
                `JSON parse error for variation "${v.name}": ${e.message}`
              );
            }
          }
        });

        await apiCall(`/experiment/${experiment.id}`, {
          method: "POST",
          body: JSON.stringify(data),
        });
        mutate();
      })}
      cta="Save"
    >
      <Field label="Name" {...form.register("name")} />
      {visualEditorEnabled && (
        <Field
          label="Type"
          render={() => (
            <RadioSelector
              value={form.watch("implementation")}
              setValue={(val: ImplementationType) =>
                form.setValue("implementation", val)
              }
              name="implementation"
              options={[
                {
                  key: "code",
                  display: "Code",
                  description:
                    "Using one of our Client Libraries (Javascript, React, PHP, Ruby, or Python)",
                },
                {
                  key: "visual",
                  display: "Visual",
                  description: "Using our point & click Visual Editor",
                },
              ]}
            />
          )}
        />
      )}
      <Field
        label="Description"
        render={(id) => (
          <MarkdownInput
            value={form.watch("description")}
            setValue={(val) => form.setValue("description", val)}
            id={id}
            placeholder="Background info, what's changing, etc."
          />
        )}
      />
      <Field
        label="Hypothesis"
        {...form.register("hypothesis")}
        placeholder="e.g. Making the signup button bigger will increase clicks and ultimately improve revenue"
        textarea
      />
      <div className="mb-3">
        <label>Variations</label>
        <div className="row align-items-top">
          {variations.fields.map((v, i) => (
            <div
              className="col-lg-4 col-md-6 mb-2"
              key={i}
              style={{ minWidth: 200 }}
            >
              <div className="border p-2 bg-white">
                <div>
                  {experiment.status === "draft" &&
                  variations.fields.length > 2 ? (
                    <button
                      className="btn btn-outline-danger btn-sm float-right"
                      onClick={(e) => {
                        e.preventDefault();
                        variations.remove(i);
                      }}
                    >
                      <FaTrash />
                    </button>
                  ) : (
                    ""
                  )}
                </div>
                <Field
                  label={i === 0 ? "Control Name" : `Variation ${i} Name`}
                  {...form.register(`variations.${i}.name`)}
                />
                {variationKeys && (
                  <Field label="Id" {...form.register(`variations.${i}.key`)} />
                )}
                <Field
                  label="Description"
                  textarea
                  {...form.register(`variations.${i}.description`)}
                />
                {implementation !== "visual" && (
                  <Field
                    label="JSON Value"
                    textarea
                    minRows={1}
                    maxRows={10}
                    placeholder='e.g. {"color": "red"}'
                    {...form.register(`variations.${i}.value`)}
                    helpText="Optional, use to parameterize experiment data."
                  />
                )}
              </div>
            </div>
          ))}
          {experiment.status === "draft" && (
            <div
              className="col-lg-4 col-md-6 mb-2 text-center"
              style={{ minWidth: 200 }}
            >
              <div className="p-3" style={{ border: "3px dotted #dee2e6" }}>
                <button
                  className="btn btn-outline-success"
                  onClick={(e) => {
                    e.preventDefault();
                    variations.append({
                      name: `Variation ${variations.fields.length}`,
                      description: "",
                      key: "",
                      value: "",
                      screenshots: [],
                    });
                  }}
                >
                  <FaPlus /> Variation
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
};

export default EditInfoForm;
