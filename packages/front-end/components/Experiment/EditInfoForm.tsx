import { FC } from "react";
import { FaPlus, FaTrash } from "react-icons/fa";
import useForm from "../../hooks/useForm";
import { useAuth } from "../../services/auth";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import MarkdownInput from "../Markdown/MarkdownInput";
import Modal from "../Modal";
import dJSON from "dirty-json";
import TextareaAutosize from "react-textarea-autosize";
import { useDefinitions } from "../../services/DefinitionsContext";

const EditInfoForm: FC<{
  experiment: ExperimentInterfaceStringDates;
  cancel: () => void;
  mutate: () => void;
}> = ({ experiment, cancel, mutate }) => {
  const { getDatasourceById } = useDefinitions();
  const [value, inputProps, manualUpdate] = useForm<
    Partial<ExperimentInterfaceStringDates>
  >(
    {
      name: experiment.name || "",
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
    experiment.id,
    {
      className: "form-control",
    }
  );
  const { apiCall } = useAuth();

  const variationKeys =
    getDatasourceById(value.datasource)?.settings?.experiments
      ?.variationFormat === "key";

  const deleteVariation = (i: number) => {
    const variations = [...value.variations];
    variations.splice(i, 1);

    const updates: Partial<ExperimentInterfaceStringDates> = { variations };

    manualUpdate(updates);
  };
  const addVariation = () => {
    const variations = [
      ...value.variations,
      {
        name: `Variation ${value.variations.length}`,
        description: "",
        key: "",
        value: "",
        screenshots: [],
      },
    ];

    const updates: Partial<ExperimentInterfaceStringDates> = { variations };

    manualUpdate(updates);
  };

  return (
    <Modal
      header={"Edit Info"}
      open={true}
      close={cancel}
      size="lg"
      submit={async () => {
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
      }}
      cta="Save"
    >
      <div className="form-group">
        <label>Name</label>
        <input type="text" {...inputProps.name} />
      </div>
      <div className="form-group">
        <label>Description</label>
        <MarkdownInput
          value={value.description}
          setValue={(description) => manualUpdate({ description })}
          placeholder="Background info, what's changing, etc."
        />
      </div>
      <div className="form-group">
        <label>Hypothesis</label>
        <textarea
          rows={3}
          placeholder="e.g. Making the signup button bigger will increase clicks and ultimately improve revenue"
          {...inputProps.hypothesis}
        />
      </div>
      <div className="mb-3">
        <label>Variations</label>
        <div className="row align-items-top">
          {value.variations.map((v, i) => (
            <div
              className="col-lg-4 col-md-6 mb-2"
              key={i}
              style={{ minWidth: 200 }}
            >
              <div className="border p-2 bg-white">
                <div>
                  {experiment.status === "draft" &&
                  value.variations.length > 2 ? (
                    <button
                      className="btn btn-outline-danger btn-sm float-right"
                      onClick={(e) => {
                        e.preventDefault();
                        deleteVariation(i);
                      }}
                    >
                      <FaTrash />
                    </button>
                  ) : (
                    ""
                  )}
                </div>
                <div className="form-group">
                  <label>{i === 0 ? "Control" : `Variation ${i}`} Name</label>
                  <input type="text" {...inputProps.variations[i].name} />
                </div>
                {variationKeys && (
                  <div className="form-group">
                    <label>Id</label>
                    <input type="text" {...inputProps.variations[i].key} />
                  </div>
                )}
                <div className="form-group">
                  <label>Description</label>
                  <textarea {...inputProps.variations[i].description} />
                </div>
                <div className="form-group">
                  <label>JSON Value</label>
                  <TextareaAutosize
                    {...inputProps.variations[i].value}
                    minRows={1}
                    maxRows={10}
                    placeholder='e.g. {"color": "red"}'
                  />
                  <small className="form-text text-muted">
                    Optional, use to parameterize experiment data.
                  </small>
                </div>
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
                    addVariation();
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
