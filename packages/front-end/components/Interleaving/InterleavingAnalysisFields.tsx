import { Box } from "@radix-ui/themes";
import type { ApiCreateInterleavingBody } from "shared/validators";
import { getDataSourceSqlDialect } from "shared/dialects";
import SelectField from "@/components/Forms/SelectField";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useInterleavingExposureQueries } from "@/hooks/useInterleavings";
import Callout from "@/ui/Callout";
import InterleavingMetricsInput from "./InterleavingMetricsInput";

export type InterleavingAnalysisValue = Pick<
  ApiCreateInterleavingBody,
  "datasource" | "interleavingExposureQueryId" | "userIdType"
> & { metrics: NonNullable<ApiCreateInterleavingBody["metrics"]> };

export function getAnalysisError(
  value: InterleavingAnalysisValue,
): string | null {
  if (!value.datasource) return "Select a data source";
  if (!value.interleavingExposureQueryId) return "Select an exposure query";
  if (!value.userIdType) return "Select an identifier type";
  return null;
}

export default function InterleavingAnalysisFields({
  value,
  setValue,
  project,
  disabled,
}: {
  value: InterleavingAnalysisValue;
  setValue: (value: InterleavingAnalysisValue) => void;
  project?: string;
  disabled?: boolean;
}) {
  const { datasources } = useDefinitions();
  const { exposureQueries, loading } = useInterleavingExposureQueries(
    value.datasource,
  );

  const eligibleDatasources = datasources.filter(
    (d) =>
      !!getDataSourceSqlDialect(d.type)?.jsonArray &&
      (!project || !d.projects?.length || d.projects.includes(project)),
  );
  const exposureQuery = exposureQueries.find(
    (q) => q.id === value.interleavingExposureQueryId,
  );
  const userIdTypes = exposureQuery?.userIdTypes ?? [];

  return (
    <Box>
      <SelectField
        label="Data Source"
        required
        value={value.datasource}
        onChange={(datasource) =>
          setValue({
            datasource,
            interleavingExposureQueryId: "",
            userIdType: "",
            metrics: [],
          })
        }
        options={eligibleDatasources.map((d) => ({
          value: d.id,
          label: d.name,
        }))}
        initialOption="Select..."
        disabled={disabled}
        helpText="Only data sources whose SQL dialect can unnest JSON arrays are listed."
      />
      {value.datasource && !loading && exposureQueries.length === 0 ? (
        <Callout status="warning" mb="3">
          This data source has no interleaving exposure queries. Create one with
          the REST API (<code>POST /api/v1/interleaving-exposure-queries</code>
          ), then come back to select it.
        </Callout>
      ) : (
        <SelectField
          label="Exposure Query"
          required
          value={value.interleavingExposureQueryId}
          onChange={(interleavingExposureQueryId) => {
            const userIdType =
              exposureQueries.find((q) => q.id === interleavingExposureQueryId)
                ?.userIdTypes[0] ?? "";
            setValue({
              ...value,
              interleavingExposureQueryId,
              userIdType,
              metrics: userIdType === value.userIdType ? value.metrics : [],
            });
          }}
          options={exposureQueries.map((q) => ({ value: q.id, label: q.name }))}
          initialOption="Select..."
          disabled={disabled || !value.datasource}
        />
      )}
      <SelectField
        label="Identifier Type"
        required
        value={value.userIdType}
        onChange={(userIdType) =>
          setValue({ ...value, userIdType, metrics: [] })
        }
        options={userIdTypes.map((t) => ({ value: t, label: t }))}
        initialOption="Select..."
        disabled={disabled || !exposureQuery}
      />
      <InterleavingMetricsInput
        value={value.metrics}
        setValue={(metrics) => setValue({ ...value, metrics })}
        datasource={value.datasource}
        userIdType={value.userIdType}
        project={project}
        disabled={disabled || !value.userIdType}
      />
    </Box>
  );
}
