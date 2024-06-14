import SelectField from "@/components/Forms/SelectField";
import { useDefinitions } from "@/services/DefinitionsContext";
import { MetricAnalysisPopulationType } from "@back-end/types/metric-analysis";
import React from "react";

export interface Props {
  value: string;
  setValue: (value: MetricAnalysisPopulationType) => void;
  setPopulationValue: (value: string | null) => void;
  
  userIdType: string;
  datasourceId: string;

  labelClassName?: string;
}

export default function PopulationChooser({
  value,
  setValue,
  setPopulationValue,
  userIdType,
  datasourceId,
  labelClassName,
}: Props) {

  const { getDatasourceById } = useDefinitions();

  // get matching exposure queries

  const datasource = getDatasourceById(datasourceId);
  const exposureQueries = (datasource?.settings?.queries?.exposure || []).filter(
    (e) => e.userIdType === userIdType
  );
  return (
    <div>
      <div className="uppercase-title text-muted">Population</div>
      <SelectField
        labelClassName={labelClassName}
        containerClassName={"select-dropdown-underline"}
        options={[
          ...(exposureQueries.length > 0 ? [{
            label: "External",
            options: [
                ...exposureQueries.map((e) => ({
                  label: `All ${userIdType} in Experiment Exposure Table "${e.name}"`,
                  value: `experiment_${e.id}`
                })),
            ]
          }] : []),
          {
            label: "Fact Table",
            options: [
                {
                    label: `All ${userIdType} matching Metric Definition` ,
                    value: "metric"
                },

                {
                  label: `All ${userIdType} in Fact Table` ,
                  value: "facttable"
              },
            ],
          },
        ]}
        value={value}
        onChange={(v) => {
          if (v === value) return;
          if(v.startsWith("experiment")) {
            setValue("exposureQuery");
            const exposureQueryId = v.match(/experiment_(.*)/)?.[1];
            setPopulationValue(exposureQueryId ?? null);
          } else {
            setValue(v as MetricAnalysisPopulationType);
            setPopulationValue(null);
          }
        }}
      />
    </div>
  );
}
