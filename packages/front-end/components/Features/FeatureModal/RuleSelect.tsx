import { FC } from "react";
import RadioSelector from "@/components/Forms/RadioSelector";

const RuleSelect: FC<{ setValue: (value: string) => void; value: string }> = ({
  value = "",
  setValue,
}) => {
  return (
    <div className="form-group">
      <label>
        Behavior <small className="text-muted">(can change later)</small>
      </label>
      <RadioSelector
        name="ruleType"
        value={value}
        labelWidth={145}
        options={[
          {
            key: "",
            display: "Simple",
            description: "All users get the same value",
          },
          {
            key: "force",
            display: "Targeted",
            description:
              "Most users get one value, a targeted segment gets another",
          },
          {
            key: "rollout",
            display: "Percentage Rollout",
            description:
              "Gradually release a value to users while everyone else gets a fallback",
          },
          {
            key: "experiment",
            display: "A/B Experiment",
            description: "Run an A/B test between multiple values.",
          },
        ]}
        setValue={setValue}
      />
    </div>
  );
};

export default RuleSelect;
