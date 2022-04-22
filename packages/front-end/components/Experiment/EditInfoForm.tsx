import { FC } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { useAuth } from "../../services/auth";
import {
  ExperimentInterfaceStringDates,
  ImplementationType,
} from "back-end/types/experiment";
import MarkdownInput from "../Markdown/MarkdownInput";
import Modal from "../Modal";
import useUser from "../../hooks/useUser";
import RadioSelector from "../Forms/RadioSelector";
import Field from "../Forms/Field";
import SelectField from "../Forms/SelectField";
import { GBAddCircle } from "../Icons";
import { MdDeleteForever } from "react-icons/md";

const EditInfoForm: FC<{
  experiment: ExperimentInterfaceStringDates;
  cancel: () => void;
  mutate: () => void;
}> = ({ experiment, cancel, mutate }) => {
  const {
    settings: { visualEditorEnabled },
  } = useUser();

  const form = useForm<Partial<ExperimentInterfaceStringDates>>({
    defaultValues: {
      name: experiment.name || "",
      implementation: experiment.implementation || "code",
      hypothesis: experiment.hypothesis || "",
      geography: experiment.geography || "",
      module: experiment.module || "",
      sampleType: experiment.sampleType || "Random",
      description: experiment.description || experiment.observations || "",
      variations: experiment.variations
        ? experiment.variations.map((v) => {
            return {
              name: "",
              description: "",
              percentGeo: 0,
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
              percentGeo: 0,
              key: "",
              screenshots: [],
            },
            {
              name: "Variation",
              description: "",
              percentGeo: 0,
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

  return (
    <Modal
      header={"Edit Info"}
      open={true}
      close={cancel}
      size="lg"
      submit={form.handleSubmit(async (value) => {
        const data = { ...value };
        data.variations = [...data.variations];

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
                    "Using one of our SDKs (Javascript, React, PHP, Ruby, Go, Kotlin, or Python)",
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
      <SelectField
        label="Geography"
        value={form.watch("geography")}
        onChange={(g) => form.setValue("geography", g)}
        options={[
          { label: 'Argentina', value: 'AR' },
          { label: 'Brazil', value: 'BR' },
          { label: 'Canada', value: 'CA' },
          { label: 'Colombia', value: 'CO' },
          { label: 'Dominican Republic', value: 'DR' },
          { label: 'Ecuador', value: 'EC' },
          { label: 'El Salvador', value: 'ES' },
          { label: 'Honduras', value: 'HO' },
          { label: 'Mexico', value: 'MX' },
          { label: 'Panama', value: 'PA' },
          { label: 'Paraguay', value: 'PY' },
          { label: 'Peru', value: 'PE' },
          { label: 'South Africa', value: 'SA' },
          { label: 'Uruguay', value: 'UY' },
        ]}
      />
      <SelectField
        label="Module"
        value={form.watch("module")}
        onChange={(m) => form.setValue("module", m)}
        options={[
          { label: 'Quick Order', value: 'QUICK_ORDER' },
          { label: 'Forgotten Items', value: 'FORGOTTEN_ITEMS' },
          { label: 'Upsell', value: 'CROSS_SELL_UP_SELL' },
        ]}
      />
      <SelectField
        label="Sample Type"
        value={form.watch("sampleType")}
        onChange={(m) => form.setValue("sampleType", m)}
        options={[
          { label: 'Random', value: 'random' },
        ]}
      />
      <div className="mb-3">
        <label>Variations</label>
        <div className="row">
          {variations.fields.map((v, i) => (
            <div
              className=" col-lg-6 col-md-6 mb-2"
              key={i}
              style={{ minWidth: 200 }}
            >
              <div className="graybox">
                <Field
                  label={i === 0 ? "Control Name" : `Variation ${i} Name`}
                  {...form.register(`variations.${i}.name`)}
                />
                <Field
                  label="Id"
                  {...form.register(`variations.${i}.key`)}
                  placeholder={i + ""}
                />
                <Field
                  label="Description"
                  textarea
                  {...form.register(`variations.${i}.description`)}
                />
                <Field 
                  label="Allocation Percentage"
                  {...form.register(`variations.${i}.percentGeo`)}
                />
                <div className="text-right">
                  {experiment.status === "draft" &&
                  variations.fields.length > 2 ? (
                    <a
                      className="text-danger cursor-pointer"
                      onClick={(e) => {
                        e.preventDefault();
                        variations.remove(i);
                      }}
                    >
                      <MdDeleteForever /> Delete
                    </a>
                  ) : (
                    ""
                  )}
                </div>
              </div>
            </div>
          ))}
          {experiment.status === "draft" && (
            <div
              className="col-lg-6 col-md-6 mb-2 text-center"
              style={{ minWidth: 200 }}
            >
              <div
                className="p-3 h-100 d-flex align-items-center justify-content-center"
                style={{ border: "1px dashed #C2C5D6", borderRadius: "3px" }}
              >
                <button
                  className="btn btn-outline-primary"
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
                  <span className="h4 pr-2 m-0 d-inline-block">
                    <GBAddCircle />
                  </span>{" "}
                  Add Variation
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
