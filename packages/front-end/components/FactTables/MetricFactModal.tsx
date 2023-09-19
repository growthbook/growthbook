import { useForm } from "react-hook-form";
import clsx from "clsx";
import { FaAngleRight } from "react-icons/fa";
import { useDefinitions } from "@/services/DefinitionsContext";
import Modal from "../Modal";
import Tooltip from "../Tooltip/Tooltip";
import SelectField from "../Forms/SelectField";
import MultiSelectField from "../Forms/MultiSelectField";
import Field from "../Forms/Field";
import InlineCode from "../SyntaxHighlighting/InlineCode";

export interface Props {
  close: () => void;
  onSave: () => void;
  initialFactTable?: string;
}

type FactRef = {
  factTableId: string;
  factId: string;
  filters: string[];
};

function FactSelector({
  value,
  setValue,
}: {
  setValue: (ref: FactRef) => void;
  value: FactRef;
}) {
  const { getFactTableById, factTables } = useDefinitions();

  const factTable = getFactTableById(value.factTableId);

  return (
    <div className="appbox px-3 pt-3 bg-light">
      <div className="row">
        <div className="col-auto">
          <SelectField
            label="Fact Table"
            value={value.factTableId}
            onChange={(factTableId) =>
              setValue({
                factTableId,
                factId: value.factId.match(/^\$\$/) ? value.factId : "",
                filters: [],
              })
            }
            options={factTables.map((t) => ({
              label: t.name,
              value: t.id,
            }))}
            placeholder="Select..."
          />
        </div>
        {factTable && (
          <div className="col-auto">
            <MultiSelectField
              label="Filters"
              value={value.filters}
              onChange={(filters) => setValue({ ...value, filters })}
              options={factTable.filters.map((f) => ({
                label: f.name,
                value: f.id,
              }))}
              placeholder="All Rows"
            />
          </div>
        )}
        {factTable && (
          <div className="col-auto">
            <SelectField
              label="Value"
              value={value.factId}
              onChange={(factId) => setValue({ ...value, factId })}
              options={[
                {
                  label: `COUNT( DISTINCT \`${
                    factTable.userIdTypes[0] || "user_id"
                  }\` )`,
                  value: "$$distinctUsers",
                },
                {
                  label: "COUNT(*)",
                  value: "$$count",
                },
                ...factTable.facts.map((f) => ({
                  label: `SUM(\`${f.name}\`)`,
                  value: f.id,
                })),
              ]}
              placeholder="Select..."
              formatOptionLabel={({ label }) => (
                <InlineCode language="sql" code={label} />
              )}
            />
          </div>
        )}
      </div>
    </div>
  );
}

export default function MetricFactModal({
  close,
  onSave,
  initialFactTable,
}: Props) {
  const form = useForm<{
    name: string;
    description: string;
    tags: string[];
    factSettings: {
      metricType: "simple" | "ratio";
      numerator: FactRef;
      denominator: FactRef | null;
    };
  }>({
    defaultValues: {
      name: "",
      description: "",
      tags: [],
      factSettings: {
        metricType: "simple",
        numerator: {
          factTableId: initialFactTable || "",
          factId: "",
          filters: [],
        },
        denominator: null,
      },
    },
  });

  const type = form.watch("factSettings.metricType");

  return (
    <Modal
      open={true}
      header="Create Metric"
      close={close}
      submit={form.handleSubmit(async (values) => {
        console.log(values);
        onSave();
        throw new Error("Not implemented yet");
      })}
      size="md"
    >
      <Field label="Metric Name" {...form.register("name")} autoFocus />
      <div className="mb-3">
        <label>
          Type of Metric{" "}
          <Tooltip
            body={
              <div>
                <div className="mb-2">
                  <strong>Simple</strong> metrics are the most common. They let
                  you report on how a single event or value changes between
                  variations in an experiment.
                </div>
                <div>
                  <strong>Ratio</strong> metrics allow you to calculate a ratio,
                  or propotion, of two different values. These allow more
                  advanced experimentation metrics.
                </div>
              </div>
            }
          />
        </label>
        <div>
          <div className="btn-group">
            <button
              type="button"
              className={clsx(
                "btn",
                type === "simple" ? "active btn-primary" : "btn-outline-primary"
              )}
              onClick={(e) => {
                e.preventDefault();
                form.setValue("factSettings.metricType", "simple");
              }}
            >
              Simple
            </button>
            <button
              type="button"
              className={clsx(
                "btn",
                type === "ratio" ? "active btn-primary" : "btn-outline-primary"
              )}
              onClick={(e) => {
                e.preventDefault();
                form.setValue("factSettings.metricType", "ratio");
              }}
            >
              Ratio
            </button>
          </div>
        </div>
      </div>
      <div className="form-group">
        <label>Numerator</label>
        <FactSelector
          value={form.watch("factSettings.numerator")}
          setValue={(numerator) =>
            form.setValue("factSettings.numerator", numerator)
          }
        />
      </div>
      <div className="form-group">
        <label>Denominator</label>
        {type === "simple" ? (
          <Tooltip body="To change the denominator, switch to a Ratio metric above">
            <div className="border p-2 rounded">
              Number of Users in Experiment
            </div>
          </Tooltip>
        ) : (
          <FactSelector
            value={
              form.watch("factSettings.denominator") || {
                factId: "",
                factTableId: "",
                filters: [],
              }
            }
            setValue={(denominator) =>
              form.setValue("factSettings.denominator", denominator)
            }
          />
        )}
      </div>
      <a href="#">
        Advanced metric settings <FaAngleRight />
      </a>
    </Modal>
  );
}
