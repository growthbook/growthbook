import React, {
  FC,
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  DataSourceInterfaceWithParams,
  ExposureQuery,
  ExperimentDimensionMetadata,
} from "back-end/types/datasource";
import cloneDeep from "lodash/cloneDeep";
import { ago } from "shared/dates";
import { QueryStatus } from "back-end/types/query";
import { DimensionSlicesInterface } from "back-end/types/dimension";
import { BsGear } from "react-icons/bs";
import { useForm } from "react-hook-form";
import { Flex, Text } from "@radix-ui/themes";
import { useGrowthBook } from "@growthbook/growthbook-react";
import { useAuth } from "@/services/auth";
import RunQueriesButton from "@/components/Queries/RunQueriesButton";
import ViewAsyncQueriesButton from "@/components/Queries/ViewAsyncQueriesButton";
import Field from "@/components/Forms/Field";
import track from "@/services/track";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import Tooltip from "@/components/Tooltip/Tooltip";
import SelectField from "@/components/Forms/SelectField";
import { AppFeatures } from "@/types/app-features";
import Link from "@/components/Radix/Link";

const smallPercentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 0,
});

export function getLatestDimensionSlices(
  dataSourceId: string,
  exposureQueryId: string,
  metadataId: string | undefined,
  apiCall: <T>(
    url: string | null,
    options?: RequestInit | undefined
  ) => Promise<T>,
  setId: (id: string) => void,
  mutate: () => void
): void {
  if (!dataSourceId || !exposureQueryId) return;
  if (metadataId) {
    setId(metadataId);
    mutate();
    return;
  } else {
    apiCall<{ dimensionSlices: DimensionSlicesInterface }>(
      `/dimension-slices/datasource/${dataSourceId}/${exposureQueryId}`
    )
      .then((res) => {
        if (res?.dimensionSlices?.id) {
          setId(res.dimensionSlices.id);
          mutate();
        }
      })
      .catch((e) => {
        console.error(e);
      });
  }
}


type DimensionSlicesRunnerProps = {
  dimensionSlices?: DimensionSlicesInterface;
  status: QueryStatus;
  setId: (id: string) => void;
  mutate: () => void;
  dataSource: DataSourceInterfaceWithParams;
  exposureQuery: ExposureQuery;
  source: string;
  onSave: ((exposureQuery: ExposureQuery) => void) | undefined;
};

export const DimensionSlicesRunner: FC<DimensionSlicesRunnerProps> = ({
  dimensionSlices,
  status,
  setId,
  mutate,
  dataSource,
  exposureQuery,
  source,
  onSave,
}) => {
  const { apiCall } = useAuth();
  const [error, setError] = useState<string>("");
  const [openLookbackField, setOpenLookbackField] = useState<boolean>(false);
  const form = useForm({
    defaultValues: {
      lookbackDays: 30,
    },
  });

  const refreshDimension = useCallback(async () => {
    track("Refresh Dimension Slices - click", { source });
    apiCall<{
      dimensionSlices: DimensionSlicesInterface;
    }>("/dimension-slices", {
      method: "POST",
      body: JSON.stringify({
        dataSourceId: dataSource.id,
        queryId: exposureQuery.id,
        lookbackDays: form.getValues("lookbackDays"),
      }),
    })
      .then((res) => {
        track("Refresh Dimension Slices - success", { source });
        setId(res.dimensionSlices.id);
        mutate();
      })
      .catch((e) => {
        track("Refresh Dimension Slices - error", {
          source,
          error: e.message.substr(0, 32) + "...",
        });
        setError(e.message);
        console.error(e.message);
      });
  }, [dataSource.id, exposureQuery.id, form, source, mutate, apiCall, setId]);

  const asyncQueriesButton = dimensionSlices?.queries ? (
    <ViewAsyncQueriesButton
      queries={
        dimensionSlices.queries?.length > 0
          ? dimensionSlices.queries.map((q) => q.query)
          : []
      }
      error={dimensionSlices.error}
      inline={true}
      status={status}
    />
  ) : null;
  return (
    <>
      <div className="col-12">
        <div className="row align-items-center mb-2">
          <strong>Dimension Values</strong>
        </div>
        <DimensionSlicesResults
          status={status}
          dimensions={exposureQuery.dimensions}
          dimensionSlices={dimensionSlices}
          refreshDimension={refreshDimension}
          exposureQuery={exposureQuery}
          onSave={onSave}
        />

        <Flex direction="column" gap="1" mt="2">
          <RefreshData
            dimensionSlices={dimensionSlices}
            refreshDimension={refreshDimension}
            mutate={mutate}
            setError={setError}
          />
          {(status === "failed" || error !== "") && dimensionSlices ? (
            <div className="alert alert-danger mt-2">
              <strong>Error updating data</strong>
              {error ? `: ${error}` : null}

              {dimensionSlices?.queries && (
                <ViewAsyncQueriesButton
                  queries={
                    dimensionSlices.queries?.length > 0
                      ? dimensionSlices.queries.map((q) => q.query)
                      : []
                  }
                  error={dimensionSlices.error}
                  inline={true}
                  status={status}
                />
              )}
            </div>
          ) : null}
          {status === "succeeded" && dimensionSlices?.results.length === 0 ? (
            <div className="alert alert-warning mt-2">
              <p className="mb-0">
                <strong>
                  No experiment assignment rows found in data source.
                </strong>{" "}
              </p>{" "}
              <p className="mb-0">
                Ensure that your Experiment Assignment Query is correctly
                specified or increase the lookback window.
              </p>
              {openLookbackField ? (
                <div className="d-inline-flex align-items-center mt-1">
                  <label className="mb-0 mr-2 small">Days to look back</label>
                  <Field
                    type="number"
                    style={{ width: 70 }}
                    {...form.register("lookbackDays", {
                      valueAsNumber: true,
                      min: 1,
                    })}
                  />
                </div>
              ) : (
                <span className="mt-1 small">
                  <a
                    role="button"
                    className="a"
                    onClick={(e) => {
                      e.preventDefault();
                      setOpenLookbackField(!openLookbackField);
                    }}
                  >
                    <BsGear />
                  </a>{" "}
                  {form.getValues("lookbackDays")} days to look back
                </span>
              )}
              {asyncQueriesButton}
            </div>
          ) : null}
        </Flex>
      </div>
    </>
  );
};

type DimensionSlicesProps = {
  status: string;
  dimensions: string[];
  dimensionSlices?: DimensionSlicesInterface;
  refreshDimension: () => Promise<void>;
  exposureQuery: ExposureQuery;
  onSave: ((exposureQuery: ExposureQuery) => void) | undefined;
};

const RefreshData = ({
  dimensionSlices,
  refreshDimension,
  mutate,
  setError,
}: {
  dimensionSlices: DimensionSlicesInterface | undefined;
  refreshDimension: () => Promise<void>;
  mutate: () => void;
  setError: (error: string) => void;
}) => {
  return (
    <Flex direction="column" gap="1">
      <Flex direction="row" gap="1">
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              setError("");
              refreshDimension();
            } catch (e) {
              setError(e.message);
              console.error(e);
            }
          }}
        >
          <RunQueriesButton
            cta={`${dimensionSlices ? "Refresh" : "Query"} Traffic Data`}
            icon={dimensionSlices ? "refresh" : "run"}
            mutate={mutate}
            model={dimensionSlices ?? { queries: [], runStarted: undefined }}
            cancelEndpoint={`/dimension-slices/${dimensionSlices?.id}/cancel`}
            color={`${dimensionSlices ? "outline-" : ""}primary`}
          />
        </form>
        {dimensionSlices?.runStarted ? (
          <Flex ml="2" direction="column" gap="">
            <Text className="small text-muted">Last updated</Text>
            <Text className="small text-muted">
              {ago(dimensionSlices.runStarted)}
            </Text>
          </Flex>
        ) : null}
      </Flex>
    </Flex>
  );
};

type ExperimentDimensionMetadataWithPriority = ExperimentDimensionMetadata & {
  priority: number;
};

export const DimensionSlicesResults: FC<DimensionSlicesProps> = ({
  dimensions,
  dimensionSlices,
  status,
  exposureQuery,
  onSave,
}) => {
  const growthbook = useGrowthBook<AppFeatures>();

  const [localExposureQuery, setLocalExposureQuery] = useState<ExposureQuery>(
    cloneDeep(exposureQuery)
  );

  const dimensionMetadata: Record<
    string,
    ExperimentDimensionMetadataWithPriority
  > = useMemo(() => {
    return (
      localExposureQuery.dimensionMetadata?.reduce((acc, m, i) => {
        acc[m.dimension] = m;
        acc[m.dimension].priority = i + 1;
        return acc;
      }, {}) || {}
    );
  }, [localExposureQuery.dimensionMetadata]);

  // Update traffic values when dimension slices change, but preserve custom values
  useEffect(() => {
    if (dimensionSlices?.results) {
      const newMetadata =
        localExposureQuery.dimensionMetadata?.map((m) => {
          const trafficResult = dimensionSlices.results.find(
            (r) => r.dimension === m.dimension
          );
          if (!trafficResult) return m;

          return {
            ...m,
            specifiedSlices: m.customSlices
              ? m.specifiedSlices
              : trafficResult.dimensionSlices.map((s) => s.name),
          };
        }) || [];

      setLocalExposureQuery((prev) => ({
        ...prev,
        dimensionMetadata: newMetadata,
      }));
    }
  }, [localExposureQuery.dimensionMetadata, dimensionSlices?.results]);

  const updateSelectedSlices = (dimension: string, values: string[]) => {
    // Update the local exposure query
    const newMetadata =
      localExposureQuery.dimensionMetadata?.map((m) =>
        m.dimension === dimension
          ? { ...m, specifiedSlices: values, customSlices: true }
          : m
      ) || [];

    setLocalExposureQuery((prev) => ({
      ...prev,
      dimensionMetadata: newMetadata,
    }));
  };

  const updatePriority = (dimension: string, priority: number) => {
    const oldPriority = dimensionMetadata[dimension].priority;

    const newMetadata: ExperimentDimensionMetadataWithPriority[] = Object.values(
      dimensionMetadata
    ).map((m) => {
      if (dimension === m.dimension) {
        return { ...m, priority };
      }
      if (m.priority >= priority && m.priority < oldPriority) {
        return { ...m, priority: m.priority + 1 };
      }
      if (m.priority > oldPriority && m.priority <= priority) {
        return { ...m, priority: m.priority - 1 };
      }
      return m;
    });
    const sortedMetadata = newMetadata.sort((a, b) => a.priority - b.priority);
    setLocalExposureQuery((prev) => ({
      ...prev,
      dimensionMetadata: sortedMetadata,
    }));
  };

  const toggleCustomDimension = (dimension: string) => {
    const trafficValues =
      dimensionSlices?.results
        .find((d) => d.dimension === dimension)
        ?.dimensionSlices.map((s) => s.name) || [];

    const metadata = localExposureQuery.dimensionMetadata?.find(
      (m) => m.dimension === dimension
    );

    const newMetadata: ExperimentDimensionMetadata = metadata
      ? {
          ...metadata,
          specifiedSlices: trafficValues,
          customSlices: !metadata.customSlices,
        }
      : {
          dimension,
          specifiedSlices: trafficValues,
          customSlices: true,
        };

    setLocalExposureQuery((prev) => ({
      ...prev,
      dimensionMetadata:
        localExposureQuery.dimensionMetadata?.map((m) =>
          m.dimension === dimension ? newMetadata : m
        ) || [],
    }));
  };

  // Notify parent of changes
  useEffect(() => {
    if (onSave) {
      onSave(localExposureQuery);
    }
  }, [localExposureQuery, onSave]);

  return (
    <>
      <table className="table appbox gbtable mt-2 mb-0">
        <thead>
          <tr>
            <th>Dimension</th>
            <th>% of Traffic</th>
            <th>
              Dimension Values{" "}
              <Tooltip body="Dimension values are the levels of a dimension used for pre-computed dimension analysis (currently only used on the Experiment Health Tab). Values not in this list will be grouped into the '__Other__' bucket."></Tooltip>
            </th>
            {growthbook.isOn("pre-computed-dimensions") ? (
              <th>
                Priority{" "}
                <Tooltip body="Higher priority dimensions are used first when choosing which dimensions to pre-compute for fast slicing and dicing."></Tooltip>
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {dimensions.map((r) => {
            const dimensionValueResult = dimensionSlices?.results.find(
              (d) => d.dimension === r
            );
            let totalPercent = 0;
            return (
              <tr key={r}>
                <td>{r}</td>
                <td>
                  {dimensionValueResult ? (
                    <>
                      <div>
                        {dimensionValueResult.dimensionSlices.map((d, i) => {
                          totalPercent += d.percent;
                          return (
                            <>
                              <Fragment key={`${r}-${i}`}>
                                {i ? ", " : ""}
                                <code key={`${r}-code-${d.name}`}>
                                  {d.name}
                                </code>
                              </Fragment>
                              <span>{` (${smallPercentFormatter.format(
                                d.percent / 100.0
                              )})`}</span>
                            </>
                          );
                        })}
                      </div>
                      <div>
                        {" "}
                        All other values:
                        <Fragment key={`${r}--1`}>
                          {" "}
                          <code key={`${r}-code-_other_`}>__Other__</code>
                        </Fragment>
                        <span>{` (${smallPercentFormatter.format(
                          (100.0 - totalPercent) / 100.0
                        )})`}</span>
                      </div>
                    </>
                  ) : (
                    <div className="text-muted">
                      {status !== "running" &&
                      (!dimensionSlices || !dimensionValueResult)
                        ? "Run dimension slices query to populate"
                        : status === "succeeded" &&
                          dimensionSlices?.results?.length === 0
                        ? "No data found"
                        : status === "running"
                        ? "Updating data"
                        : ""}
                    </div>
                  )}
                </td>
                <td>
                  <div className="d-flex flex-column">
                    {dimensionMetadata[r]?.customSlices ? (
                      <>
                        <MultiSelectField
                          value={dimensionMetadata[r]?.specifiedSlices || []}
                          onChange={(values) => updateSelectedSlices(r, values)}
                          options={(
                            dimensionValueResult?.dimensionSlices.map(
                              (d) => d.name
                            ) ?? []
                          )
                            .concat(dimensionMetadata[r]?.specifiedSlices || [])
                            .map((v) => ({
                              value: v,
                              label: v,
                            }))}
                          max={20}
                          placeholder="Select dimension values..."
                          creatable={true}
                          closeMenuOnSelect={false}
                        />
                        <Text className="text-muted">
                          {dimensionMetadata[r]?.specifiedSlices?.length === 20
                            ? "20 values max"
                            : ""}
                        </Text>
                        <Link
                          className="mt-1 small"
                          onClick={() => toggleCustomDimension(r)}
                        >
                          Use traffic values
                        </Link>
                      </>
                    ) : (
                      <Flex direction="column" gap="1">
                        <Text>Using values found in traffic</Text>
                        <Link
                          className="small"
                          onClick={() => toggleCustomDimension(r)}
                        >
                          Customize values
                        </Link>
                      </Flex>
                    )}
                  </div>
                </td>
                {growthbook.isOn("pre-computed-dimensions") ? (
                  <td>
                    <SelectField
                      value={dimensionMetadata[r]?.priority?.toString()}
                      onChange={(value) => updatePriority(r, parseInt(value))}
                      options={Object.values(dimensionMetadata).map((_, i) => ({
                        value: (i + 1).toString(),
                        label: (i + 1).toString(),
                      }))}
                    />
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
};
