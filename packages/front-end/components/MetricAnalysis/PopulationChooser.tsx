import React from "react";

import { FaQuestionCircle } from "react-icons/fa";
import { MetricAnalysisPopulationType } from "shared/types/metric-analysis";
import SelectField from "@/components/Forms/SelectField";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import Tooltip from "@/components/Tooltip/Tooltip";
import Text from "@/ui/Text";

export interface Props {
  value: string;
  setValue: (
    value: MetricAnalysisPopulationType,
    populationId: string | null,
  ) => void;
  userIdType: string;
  datasourceId: string;
  newStyle?: boolean;
}

export default function PopulationChooser({
  value,
  setValue,
  userIdType,
  datasourceId,
  newStyle,
}: Props) {
  const { getDatasourceById, segments } = useDefinitions();
  const { hasCommercialFeature } = useUser();

  const hasMetricPopulations = hasCommercialFeature("metric-populations");

  // get matching exposure queries
  const datasource = getDatasourceById(datasourceId);
  const availableExposureQueries = (
    datasource?.settings?.queries?.exposure || []
  )
    .filter((e) => e.userIdType === userIdType)
    .map((e) => ({
      label: `Experiment Exposed Units: ${e.name}`,
      value: `experiment_${e.id}`,
      isDisabled: !hasMetricPopulations,
    }));

  // get matching segments
  const availableSegments = segments
    .filter((s) => s.datasource === datasourceId && s.userIdType === userIdType)
    .map((s) => {
      return {
        label: `Segment: ${s.name}`,
        value: `segment_${s.id}`,
        isDisabled: !hasMetricPopulations,
      };
    });

  return (
    <div>
      {!newStyle && (
        <div className="uppercase-title text-muted">
          Population{" "}
          <Tooltip
            body={`The metric values will only come from units in this population.
            For experiment assignment tables, any unit exposed to an
            experiment in the selected date window is in the population.`}
          >
            <FaQuestionCircle />
          </Tooltip>
        </div>
      )}
      <SelectField
        label={
          newStyle ? (
            <Text as="label" size="large" weight="medium">
              Population
            </Text>
          ) : undefined
        }
        labelClassName={newStyle ? "mb-0" : undefined}
        containerClassName={newStyle ? "mb-0" : "select-dropdown-underline"}
        options={[
          {
            label: "Fact Table",
            options: [
              {
                label: `Fact Table (default)`,
                value: "factTable",
              },
            ],
          },
          ...(availableSegments.length > 0
            ? [
                {
                  label: `Joined Populations`,
                  options: [...availableSegments, ...availableExposureQueries],
                },
              ]
            : []),
        ]}
        formatOptionLabel={(option) => {
          return option.value === "factTable" ? (
            <div>{option.label}</div>
          ) : (
            <PremiumTooltip commercialFeature="metric-populations">
              <span className={!hasMetricPopulations ? "text-muted" : ""}>
                {option.label}
              </span>
            </PremiumTooltip>
          );
        }}
        sort={false}
        value={value}
        onChange={(v) => {
          if (v === value) return;
          if (v.startsWith("experiment")) {
            const exposureQueryId = v.match(/experiment_(.*)/)?.[1];
            setValue("exposureQuery", exposureQueryId ?? null);
          } else if (v.startsWith("segment")) {
            const segmentId = v.match(/segment_(.*)/)?.[1];
            setValue("segment", segmentId ?? null);
          } else {
            setValue(v as MetricAnalysisPopulationType, null);
          }
        }}
      />
    </div>
  );
}
