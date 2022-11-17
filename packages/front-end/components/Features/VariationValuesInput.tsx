import { Variation } from "back-end/types/experiment";
import { ExperimentRefValue, FeatureValueType } from "back-end/types/feature";
import FeatureValueField from "./FeatureValueField";

export function VariationValuesInput({
  values,
  setValues,
  type,
  variations,
}: {
  values: ExperimentRefValue[];
  setValues: (values: ExperimentRefValue[]) => void;
  type: FeatureValueType;
  variations: Variation[];
}) {
  return (
    <div className="appbox p-3 bg-light">
      <h4>Variation Values</h4>
      {variations.map((variation, i) => {
        const label =
          variations[i]?.name || (i ? `Variation ${i + 1}` : "Control");
        return (
          <FeatureValueField
            key={i}
            id={`feat-variation-${i}`}
            label={label}
            value={values[i]?.value || ""}
            setValue={(v) => {
              const clone = [...values];
              clone[i] = {
                ...clone[i],
                value: v,
              };
              setValues(clone);
            }}
            valueType={type}
          />
        );
      })}
    </div>
  );
}
