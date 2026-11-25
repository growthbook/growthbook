import { Box } from "@radix-ui/themes";
import type { I18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ApiInterleavingInterface } from "shared/validators";
import { getDataSourceSqlDialect } from "shared/dialects";
import SelectField from "@/components/Forms/SelectField";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useInterleavingExposureQueries } from "@/hooks/useInterleavings";
import Callout from "@/ui/Callout";
import Link from "@/ui/Link";
import InterleavingMetricsInput from "./InterleavingMetricsInput";

export type InterleavingAnalysisValue = Pick<
  ApiInterleavingInterface,
  "datasourceId" | "interleavingExposureQueryId" | "userIdType" | "metrics"
>;

export function getAnalysisError(
  value: InterleavingAnalysisValue,
  i18n: I18n,
): string | null {
  if (!value.datasourceId) return i18n._(msg`Select a Data Source`);
  if (!value.interleavingExposureQueryId) {
    return i18n._(msg`Select an exposure query`);
  }
  if (!value.userIdType) return i18n._(msg`Select an identifier type`);
  return null;
}

export default function InterleavingAnalysisFields({
  value,
  setValue,
  project,
  disabled,
  onAddExposureQuery,
}: {
  value: InterleavingAnalysisValue;
  setValue: (value: InterleavingAnalysisValue) => void;
  project?: string;
  disabled?: boolean;
  onAddExposureQuery?: () => void;
}) {
  const { t } = useLingui();
  const { datasources } = useDefinitions();
  const { exposureQueries, loading } = useInterleavingExposureQueries(
    value.datasourceId,
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
        label={t`Data Source`}
        required
        value={value.datasourceId}
        onChange={(datasourceId) =>
          setValue({
            datasourceId,
            interleavingExposureQueryId: "",
            userIdType: "",
            metrics: [],
          })
        }
        options={eligibleDatasources.map((d) => ({
          value: d.id,
          label: d.name,
        }))}
        disabled={disabled}
        helpText={t`Only Data Sources whose SQL dialect can unnest JSON arrays are listed.`}
      />
      {value.datasourceId && !loading && exposureQueries.length === 0 ? (
        <Callout status="warning" mb="3">
          <Trans>
            No Interleaving Exposure Queries exist for this Data Source yet.
          </Trans>{" "}
          {onAddExposureQuery ? (
            <Trans>
              <Link
                href="#"
                className="underline"
                onClick={(e) => {
                  e.preventDefault();
                  onAddExposureQuery();
                }}
              >
                Add one
              </Link>
              .
            </Trans>
          ) : null}
        </Callout>
      ) : (
        <SelectField
          label={t`Interleaving Exposure Query`}
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
          sort={false}
          disabled={disabled || !value.datasourceId}
        />
      )}
      <SelectField
        label={t`Identifier type`}
        required
        value={value.userIdType}
        onChange={(userIdType) =>
          setValue({ ...value, userIdType, metrics: [] })
        }
        options={userIdTypes.map((type) => ({ value: type, label: type }))}
        sort={false}
        disabled={disabled || !exposureQuery}
      />
      <InterleavingMetricsInput
        value={value.metrics}
        setValue={(metrics) => setValue({ ...value, metrics })}
        datasource={value.datasourceId}
        userIdType={value.userIdType}
        project={project}
        disabled={disabled || !value.userIdType}
      />
    </Box>
  );
}
