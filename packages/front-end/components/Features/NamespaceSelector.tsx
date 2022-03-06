import { UseFormReturn } from "react-hook-form";
import Tooltip from "../Tooltip";
import SelectField from "../Forms/SelectField";
import useApi from "../../hooks/useApi";
import { NamespaceApiResponse } from "../../pages/settings/namespaces";
import { useEffect, useState } from "react";
import Toggle from "../Forms/Toggle";

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 2,
});

export interface Props {
  experimentKey?: string;
  // eslint-disable-next-line
  form: UseFormReturn<any>;
  formPrefix?: string;
}

export default function NamespaceSelector({
  form,
  formPrefix = "",
  experimentKey = "",
}: Props) {
  const { data, error } = useApi<NamespaceApiResponse>(
    `/organization/namespaces`
  );
  const [namespaceSelected, setNamespaceSelected] = useState(
    form.watch(`${formPrefix}namespace.name`) || null
  );
  const [maxRange, setMaxRange] = useState(1);
  const [range, setRange] = useState(0);
  const [startRange, setStartRange] = useState(0);
  const [namespaceEnabled, setNamespaceEnabled] = useState(
    form.watch(`${formPrefix}namespace.enabled`) || false
  );

  useEffect(() => {
    try {
      if (
        namespaceSelected &&
        namespaceMap &&
        namespaceMap.has(namespaceSelected)
      ) {
        const ns = namespaceMap.get(namespaceSelected);
        setMaxRange(ns.rangeRemaining);
        setRange(ns.rangeRemaining);
        form.setValue(`${formPrefix}namespace.range.0`, ns.largestGapRange[0]);
        setStartRange(ns.largestGapRange[0]);
        // check to see if this is an edit before adjusting the range:
        if (ns.experiments.length > 0) {
          ns.experiments.forEach((e) => {
            if (experimentKey === e.experimentKey) {
              // this is the same - so it's an edit: (do we have a better way to determine this?)
              form.setValue(`${formPrefix}namespace.range.0`, e.range[0]);
              form.setValue(`${formPrefix}namespace.range.1`, e.range[1]);
              setRange(e.range[1] - e.range[0]);
              setStartRange(e.range[0]);
              // adjust max range:
              if (ns.largestGapRange[0] === e.range[1]) {
                // the range is continuous, so allow them to expand into it.
                setMaxRange(
                  Math.round(
                    (ns.rangeRemaining + (e.range[1] - e.range[0])) * 100
                  ) / 100
                );
              } else {
                // there is another experiment next to this range, so we can only shrink it.
                // set max range to the existing range
                setMaxRange(Math.round((e.range[1] - e.range[0]) * 100) / 100);
              }
            }
          });
        }
      }
    } catch (e) {
      console.error(e);
    }
  }, [namespaceSelected, data?.namespaces]);

  if (!data || error) return null;

  const namespaceMap = new Map();
  data.namespaces.forEach((n) => {
    namespaceMap.set(n.name, n);
  });
  const options = [
    ...data.namespaces.map((n) => ({
      value: n.name,
      label: n.name,
    })),
  ];
  const ns = namespaceMap.get(namespaceSelected);

  return (
    <div className="form-group">
      <Toggle
        id={"namepsacetoggle"}
        value={namespaceEnabled}
        setValue={(v) => {
          setNamespaceEnabled(v);
          form.setValue(`${formPrefix}namespace.enabled`, v);
        }}
      />{" "}
      Enable Namespace{" "}
      <Tooltip
        tipMinWidth="300px"
        tipPosition="left"
        text="Namespaces allow you to do mutually exclusive experiments. Experiments in the same namespace with different ranges will be exclusive from each other"
      />
      {namespaceEnabled && (
        <div className="mt-3 bg-light p-3">
          <label>Namespace</label>
          <SelectField
            value={form.watch(`${formPrefix}namespace.name`)}
            onChange={(v) => {
              form.setValue(`${formPrefix}namespace.name`, v);
              setNamespaceSelected(v);
            }}
            helpText="Add this experiment to a namespace."
            placeholder="Choose one..."
            options={options}
          />
          {namespaceSelected && namespaceMap.has(namespaceSelected) && (
            <div className="mt-3">
              <label>
                Percent namespace to use{" "}
                <span className="text-muted">
                  (range available: {percentFormatter.format(maxRange)})
                </span>
              </label>
              <div className="form-group">
                <div className="row align-items-center">
                  <div className="col">
                    <input
                      value={range}
                      onChange={(e) => {
                        const value = parseFloat(e.target.value);
                        setRange(value);
                        form.setValue(
                          `${formPrefix}namespace.range.1`,
                          startRange + value
                        );
                      }}
                      min="0"
                      max={maxRange}
                      step="0.01"
                      type="range"
                      className="w-100"
                    />
                  </div>
                  <div
                    className="col-auto"
                    style={{ fontSize: "1.3em", width: "4em" }}
                  >
                    {percentFormatter.format(range)}
                  </div>
                </div>
              </div>
              <div className="row">
                <div className="col">
                  <label>Experiments in this namespace:</label>
                  {ns.experiments.length > 0 ? (
                    <div className="text-muted">
                      {ns.experiments.map((e, i) => {
                        if (e.experimentKey !== experimentKey) {
                          return (
                            <div className="row" key={i}>
                              <div className="col">
                                Name: <strong>{e.experimentKey}</strong>
                              </div>
                              <div className="col">
                                Percent range used:{" "}
                                <strong>
                                  {percentFormatter.format(
                                    e.range[1] - e.range[0]
                                  )}
                                </strong>
                              </div>
                            </div>
                          );
                        }
                      })}
                    </div>
                  ) : (
                    <>No other experiments</>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
