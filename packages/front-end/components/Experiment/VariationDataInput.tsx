import { useFieldArray, UseFormReturn } from "react-hook-form";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { MdDeleteForever } from "react-icons/md";
import Field from "../Forms/Field";
import { GBAddCircle } from "../Icons";

export interface Props {
  form: UseFormReturn<Partial<ExperimentInterfaceStringDates>>;
  className?: string;
}

export default function VariationDataInput({ form, className = "" }: Props) {
  const variations = useFieldArray({
    control: form.control,
    name: "variations",
  });

  return (
    <div className={className}>
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
              <div className="text-right">
                {variations.fields.length > 2 ? (
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
      </div>
    </div>
  );
}
