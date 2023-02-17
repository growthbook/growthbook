import { FC } from "react";
import { UseFormRegisterReturn } from "react-hook-form";
import { FeatureValueType } from "back-end/types/feature";
import Field from "@/components/Forms/Field";
import { useAttributeSchema } from "@/services/features";
import RolloutPercentInput from "../RolloutPercentInput";
import ConditionInput from "../ConditionInput";
import FeatureValueField from "../FeatureValueField";

const RolloutDefaultValueField: FC<
  {
    coverageValue: number;
    setCoverageValue: (n: number) => void;
    conditionValue: string;
    setConditionValue: (c: string) => void;
    rolloutValue: string;
    setRolloutValue: (v: string) => void;
    valueType: FeatureValueType;
    fallbackValue: string;
    setFallbackValue: (v: string) => void;
  } & UseFormRegisterReturn
> = ({
  coverageValue,
  setCoverageValue,
  conditionValue,
  setConditionValue,
  rolloutValue,
  setRolloutValue,
  valueType,
  fallbackValue,
  setFallbackValue,
  ...hashAttributeRegisterFields
}) => {
  const attributeSchema = useAttributeSchema();
  const hasHashAttributes =
    attributeSchema.filter((x) => x.hashAttribute)?.length > 0;
  return (
    <>
      <Field
        label="Sample users based on attribute"
        {...hashAttributeRegisterFields}
        options={attributeSchema
          .filter((s) => !hasHashAttributes || s.hashAttribute)
          .map((s) => s.property)}
        helpText="Will be hashed together with the feature key to determine if user is part of the rollout"
      />
      <RolloutPercentInput
        value={coverageValue}
        setValue={setCoverageValue}
        label="Percent of users to include"
      />
      <ConditionInput
        defaultValue={conditionValue}
        onChange={setConditionValue}
      />
      <FeatureValueField
        label={"Value to Rollout"}
        id="ruleValue"
        value={rolloutValue}
        setValue={setRolloutValue}
        valueType={valueType}
      />
      <FeatureValueField
        label={"Fallback Value"}
        id="defaultValue"
        value={fallbackValue}
        setValue={setFallbackValue}
        valueType={valueType}
        helpText={"For users not included in the rollout"}
      />
    </>
  );
};

export default RolloutDefaultValueField;
