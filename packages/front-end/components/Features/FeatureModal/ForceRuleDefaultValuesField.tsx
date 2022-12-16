import { FC } from "react";
import { FeatureValueType } from "back-end/types/feature";
import FeatureValueField from "../FeatureValueField";
import ConditionInput from "../ConditionInput";

const ForceRuleDefaultValueField: FC<{
  valueType: FeatureValueType;
  conditionValue: string;
  setConditionValue: (c: string) => void;
  ruleValue: string;
  setRuleValue: (v: string) => void;
  fallbackValue: string;
  setFallbackValue: (v: string) => void;
}> = ({
  valueType,
  conditionValue,
  setConditionValue,
  ruleValue,
  setRuleValue,
  fallbackValue,
  setFallbackValue,
}) => {
  return (
    <>
      <ConditionInput
        defaultValue={conditionValue}
        onChange={setConditionValue}
      />
      <FeatureValueField
        label={"Value to Force"}
        id="ruleValue"
        value={ruleValue}
        setValue={setRuleValue}
        valueType={valueType}
        helpText={
          <>
            When targeting conditions are <code>true</code>
          </>
        }
      />
      <FeatureValueField
        label={"Fallback Value"}
        id="defaultValue"
        value={fallbackValue}
        setValue={setFallbackValue}
        valueType={valueType}
        helpText={
          <>
            When targeting conditions are <code>false</code>
          </>
        }
      />
    </>
  );
};

export default ForceRuleDefaultValueField;
