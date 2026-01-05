import React, { FC, Fragment, useState } from "react";
import { ago } from "shared/dates";
import { DimensionSlicesInterface } from "shared/types/dimension";
import { BsGear } from "react-icons/bs";
import { useForm } from "react-hook-form";
import { Box, Flex, Text } from "@radix-ui/themes";
import { useGrowthBook } from "@growthbook/growthbook-react";
import { QueryStatus } from "shared/types/query";
import RunQueriesButton, {
  getQueryStatus,
} from "@/components/Queries/RunQueriesButton";
import ViewAsyncQueriesButton from "@/components/Queries/ViewAsyncQueriesButton";
import Field from "@/components/Forms/Field";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import Tooltip from "@/components/Tooltip/Tooltip";
import SelectField from "@/components/Forms/SelectField";
import { AppFeatures } from "@/types/app-features";
import Link from "@/ui/Link";
import { useAuth } from "@/services/auth";

const smallPercentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 0,
});

export type CustomDimensionMetadata = {
  dimension: string;
  customSlicesArray?: string[];
  priority: number;
};

type DimensionSlicesRunnerProps = {
  exposureQueryId: string;
  datasourceId: string;
  customDimensionMetadata: CustomDimensionMetadata[];
  setCustomDimensionMetadata: (
    customDimensionMetadata: CustomDimensionMetadata[],
  ) => void;
  dimensionSlices?: DimensionSlicesInterface;
  mutateDimensionSlices: () => void;
  setDimensionSlicesId: (dimensionSlicesId: string) => void;
};

export const DimensionSlicesRunner: FC<DimensionSlicesRunnerProps> = ({
  exposureQueryId,
  datasourceId,
  customDimensionMetadata,
  setCustomDimensionMetadata,
  dimensionSlices,
  mutateDimensionSlices,
  setDimensionSlicesId,
}) => {
  const { apiCall } = useAuth();
  const [error, setError] = useState<string>("");
  const [openLookbackField, setOpenLookbackField] = useState<boolean>(false);
  const form = useForm({
    defaultValues: {
      lookbackDays: 30,
    },
  });

  const { status } = getQueryStatus(
    dimensionSlices?.queries ?? [],
    dimensionSlices?.error ?? "",
  );

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

  const refreshDimensionSlices = async () => {
    apiCall<{
      dimensionSlices: DimensionSlicesInterface;
    }>("/dimension-slices", {
      method: "POST",
      body: JSON.stringify({
        dataSourceId: datasourceId,
        queryId: exposureQueryId,
        lookbackDays: form.watch("lookbackDays"),
      }),
    })
      .then((res) => {
        setDimensionSlicesId(res.dimensionSlices.id);
      })
      .catch((e) => {
        console.error(e.message);
      });
  };

  const lookbackField = openLookbackField ? (
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
  );

  const ErrorBox = (
    <>
      {(status === "failed" || error !== "") && dimensionSlices ? (
        <div className="alert alert-danger mt-2">
          <Flex direction="column" gap="1">
            <Box>
              <strong>Error updating data</strong>
              {error ? `: ${error}` : null}
            </Box>
            <Box>{lookbackField}</Box>
            <Box>{asyncQueriesButton}</Box>
          </Flex>
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
            Ensure that your Experiment Assignment Query is correctly specified
            or increase the lookback window.
          </p>
          {lookbackField}
          {asyncQueriesButton}
        </div>
      ) : null}
    </>
  );

  return (
    <>
      <div className="col-12">
        <Flex direction="row" gap="1" mb="2" justify="end">
          <RefreshData
            dimensionSlices={dimensionSlices}
            refreshDimensionSlices={refreshDimensionSlices}
            mutate={mutateDimensionSlices}
            setError={setError}
          />
        </Flex>
        {ErrorBox ? (
          <Flex direction="column" gap="1" mt="2">
            {ErrorBox}
          </Flex>
        ) : null}
        <DimensionSlicesResults
          customDimensionMetadata={customDimensionMetadata}
          setCustomDimensionMetadata={setCustomDimensionMetadata}
          status={status}
          dimensionSlices={dimensionSlices}
        />
      </div>
    </>
  );
};

const RefreshData = ({
  dimensionSlices,
  refreshDimensionSlices,
  mutate,
  setError,
}: {
  dimensionSlices: DimensionSlicesInterface | undefined;
  refreshDimensionSlices: () => Promise<void>;
  mutate: () => void;
  setError: (error: string) => void;
}) => {
  return (
    <Flex direction="column" gap="1">
      <Flex direction="row" gap="1">
        {dimensionSlices?.runStarted ? (
          <Flex mr="2" direction="column" gap="">
            <Text className="small text-muted">Last updated</Text>
            <Text className="small text-muted">
              {ago(dimensionSlices.runStarted)}
            </Text>
          </Flex>
        ) : null}
        <RunQueriesButton
          cta={`${dimensionSlices ? "Refresh" : "Query"} Traffic Data`}
          icon={dimensionSlices ? "refresh" : "run"}
          mutate={mutate}
          model={dimensionSlices ?? { queries: [], runStarted: undefined }}
          cancelEndpoint={`/dimension-slices/${dimensionSlices?.id}/cancel`}
          color={`${dimensionSlices ? "outline-" : ""}primary`}
          onSubmit={async () => {
            try {
              setError("");
              await refreshDimensionSlices();
            } catch (e) {
              setError(e.message);
              console.error(e);
            }
          }}
        />
      </Flex>
    </Flex>
  );
};

export const DimensionSlicesResults: FC<{
  customDimensionMetadata: CustomDimensionMetadata[];
  setCustomDimensionMetadata: (
    customDimensionMetadata: CustomDimensionMetadata[],
  ) => void;
  dimensionSlices?: DimensionSlicesInterface;
  status: QueryStatus;
}> = ({
  customDimensionMetadata,
  setCustomDimensionMetadata,
  dimensionSlices,
  status,
}) => {
  const growthbook = useGrowthBook<AppFeatures>();

  const updateCustomSelectedSlices = (dimension: string, values: string[]) => {
    const newCustomDimensionMetadata: CustomDimensionMetadata[] = [];
    customDimensionMetadata.forEach((v) => {
      if (v.dimension === dimension) {
        newCustomDimensionMetadata.push({
          dimension,
          customSlicesArray: values,
          priority: v.priority,
        });
      } else {
        newCustomDimensionMetadata.push(v);
      }
    });
    setCustomDimensionMetadata(newCustomDimensionMetadata);
  };

  const updatePriority = (dimension: string, priority: number) => {
    const oldPriority = customDimensionMetadata.find(
      (v) => v.dimension === dimension,
    )?.priority;

    const newCustomDimensionMetadata: CustomDimensionMetadata[] = [];
    customDimensionMetadata.forEach((v) => {
      if (v.dimension === dimension) {
        newCustomDimensionMetadata.push({
          dimension,
          customSlicesArray: v.customSlicesArray,
          priority: priority,
        });
      } else if (v.priority >= priority && v.priority < (oldPriority ?? 0)) {
        newCustomDimensionMetadata.push({
          ...v,
          priority: v.priority + 1,
        });
      } else if (v.priority > (oldPriority ?? 0) && v.priority <= priority) {
        newCustomDimensionMetadata.push({
          ...v,
          priority: v.priority - 1,
        });
      } else {
        newCustomDimensionMetadata.push(v);
      }
    });
    setCustomDimensionMetadata(newCustomDimensionMetadata);
  };

  const toggleCustomDimension = (dimension: string) => {
    const trafficValues =
      dimensionSlices?.results
        .find((d) => d.dimension === dimension)
        ?.dimensionSlices.map((s) => s.name) || [];

    const newMetadata = customDimensionMetadata.map((v) => {
      if (v.dimension === dimension) {
        return {
          dimension,
          customSlicesArray:
            v.customSlicesArray === undefined ? trafficValues : undefined,
          priority: v.priority,
        };
      }

      return v;
    });

    setCustomDimensionMetadata(newMetadata);
  };

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
          {customDimensionMetadata.map((metadata) => {
            const dimensionValueResult = dimensionSlices?.results.find(
              (d) => d.dimension === metadata.dimension,
            );
            let totalPercent = 0;
            return (
              <tr key={metadata.dimension}>
                <td>{metadata.dimension}</td>
                <td>
                  {dimensionValueResult ? (
                    <>
                      <div>
                        {dimensionValueResult.dimensionSlices.map((d, i) => {
                          totalPercent += d.percent;
                          return (
                            <>
                              <Fragment key={`${metadata.dimension}-${i}`}>
                                {i ? ", " : ""}
                                <code
                                  key={`${metadata.dimension}-code-${d.name}`}
                                >
                                  {d.name}
                                </code>
                              </Fragment>
                              <span>{` (${smallPercentFormatter.format(
                                d.percent / 100.0,
                              )})`}</span>
                            </>
                          );
                        })}
                      </div>
                      <div>
                        {" "}
                        All other values:
                        <Fragment key={`${metadata.dimension}--other`}>
                          {" "}
                          <code key={`${metadata.dimension}-code-_other_`}>
                            __Other__
                          </code>
                        </Fragment>
                        <span>{` (${smallPercentFormatter.format(
                          (100.0 - totalPercent) / 100.0,
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
                    {metadata?.customSlicesArray ? (
                      <>
                        <MultiSelectField
                          value={metadata?.customSlicesArray || []}
                          onChange={(values) =>
                            updateCustomSelectedSlices(
                              metadata.dimension,
                              values,
                            )
                          }
                          options={(
                            dimensionValueResult?.dimensionSlices.map(
                              (d) => d.name,
                            ) ?? []
                          )
                            .concat(metadata?.customSlicesArray || [])
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
                          {metadata?.customSlicesArray?.length === 20
                            ? "20 values max"
                            : ""}
                        </Text>
                        <Link
                          className="mt-1 small"
                          onClick={() =>
                            toggleCustomDimension(metadata.dimension)
                          }
                        >
                          Use traffic values
                        </Link>
                      </>
                    ) : (
                      <Flex direction="column" gap="1">
                        <Text>Using values found in traffic</Text>
                        <Link
                          className="small"
                          onClick={() =>
                            toggleCustomDimension(metadata.dimension)
                          }
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
                      value={metadata.priority?.toString() ?? "0"}
                      onChange={(value) =>
                        updatePriority(metadata.dimension, parseInt(value))
                      }
                      options={Object.values(customDimensionMetadata).map(
                        (_, i) => ({
                          value: (i + 1).toString(),
                          label: (i + 1).toString(),
                        }),
                      )}
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
