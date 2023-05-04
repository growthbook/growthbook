import { FC } from "react";
import { UseFormReturn, UseFormRegisterReturn } from "react-hook-form";
import { ExperimentValue, FeatureValueType } from "back-end/types/feature";
import { useAttributeSchema } from "@/services/features";
import useOrgSettings from "@/hooks/useOrgSettings";
import Field from "@/components/Forms/Field";
import ConditionInput from "../ConditionInput";
import NamespaceSelector from "../NamespaceSelector";
import FeatureValueField from "../FeatureValueField";
import { SortableVariation } from "../SortableFeatureVariationRow";
import FeatureVariationsInput from "../FeatureVariationsInput";

const ExperimentRuleDefaultValuesField: FC<{
  // TODO Don't pass the entire form in here bruther
  // eslint-disable-next-line
  form: UseFormReturn<any>;
  featureKey: string;
  trackingKeyFormField: UseFormRegisterReturn;
  trackingKeyValue: string;
  hashAttributeFormField: UseFormRegisterReturn;
  conditionValue: string;
  setConditionValue: (c: string) => void;
  coverageValue: number;
  setCoverageValue: (n: number) => void;
  valueType: FeatureValueType;
  setWeight: (index: number, weight: number) => void;
  variationsDefaultValue?: string;
  variations: SortableVariation[];
  setVariations?: (variations: ExperimentValue[]) => void;
  fallbackValue: string;
  setFallbackValue: (v: string) => void;
}> = ({
  form,
  featureKey,
  trackingKeyValue,
  trackingKeyFormField,
  hashAttributeFormField,
  conditionValue,
  setConditionValue,
  coverageValue,
  setCoverageValue,
  valueType,
  setWeight,
  variationsDefaultValue,
  variations,
  setVariations,
  fallbackValue,
  setFallbackValue,
}) => {
  const attributeSchema = useAttributeSchema();
  const hasHashAttributes =
    attributeSchema.filter((x) => x.hashAttribute)?.length > 0;
  const { namespaces } = useOrgSettings();
  return (
    <>
      <Field
        label="Tracking Key"
        {...trackingKeyFormField}
        placeholder={featureKey}
        helpText="Unique identifier for this experiment, used to track impressions and analyze results."
      />
      <Field
        label="Sample users based on attribute"
        {...hashAttributeFormField}
        options={attributeSchema
          .filter((s) => !hasHashAttributes || s.hashAttribute)
          .map((s) => s.property)}
        helpText="Will be hashed together with the Tracking Key to pick a value"
      />
      <ConditionInput
        defaultValue={conditionValue}
        onChange={setConditionValue}
      />
      <FeatureVariationsInput
        coverage={coverageValue}
        setCoverage={setCoverageValue}
        setWeight={setWeight}
        variations={variations}
        setVariations={setVariations}
        defaultValue={variationsDefaultValue}
        valueType={valueType}
      />
      {/* @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'. */}
      {namespaces?.length > 0 && (
        <NamespaceSelector
          form={form}
          formPrefix="rule."
          featureId={featureKey}
          trackingKey={trackingKeyValue}
        />
      )}
      <FeatureValueField
        label={"Fallback Value"}
        helpText={"For people excluded from the experiment"}
        id="defaultValue"
        value={fallbackValue}
        setValue={setFallbackValue}
        valueType={valueType}
      />
    </>
  );
};

export default ExperimentRuleDefaultValuesField;
