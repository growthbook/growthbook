import React, { FC, Fragment, useCallback, useEffect, useState } from "react";
import {
  DataSourceInterfaceWithParams,
  ExposureQuery,
} from "back-end/types/datasource";
import cloneDeep from "lodash/cloneDeep";
import {
  DimensionMetadataInterface,
  DimensionMetadataResult,
} from "back-end/src/types/Integration";
import { ago, datetime } from "shared/dates";
import { QueryStatus } from "back-end/types/query";
import { AUTOMATIC_DIMENSION_OTHER_NAME } from "shared/constants";
import { useAuth } from "@/services/auth";
import useApi from "@/hooks/useApi";
import RunQueriesButton, {
  getQueryStatus,
} from "@/components/Queries/RunQueriesButton";
import ViewAsyncQueriesButton from "@/components/Queries/ViewAsyncQueriesButton";
import Modal from "@/components/Modal";

const smallPercentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 0,
});

export async function setExposureId(
  exposureQuery: ExposureQuery,
  dataSource: DataSourceInterfaceWithParams,
  apiCall: <T>(
    url: string | null,
    options?: RequestInit | undefined
  ) => Promise<T>,
  setId: (id: string) => void,
  mutate: () => void
): Promise<void> {
  if (exposureQuery.dimensionMetadataId) {
    setId(exposureQuery.dimensionMetadataId);
    await mutate();
  } else {
    try {
      const res = await apiCall<{
        dimensionMetadata: DimensionMetadataInterface;
      }>(
        `/automatic-dimension/datasource/${dataSource.id}/${exposureQuery.id}`
      );
      if (res?.dimensionMetadata?.id) {
        setId(res.dimensionMetadata.id);
        await mutate();
      }
    } catch (e) {
      console.error(e);
    }
  }
}

type UpdateDimensionMetadataModalProps = {
  exposureQuery: ExposureQuery;
  dataSource: DataSourceInterfaceWithParams;
  close: () => void;
  onSave: (exposureQuery: ExposureQuery) => void;
};

export const UpdateDimensionMetadataModal: FC<UpdateDimensionMetadataModalProps> = ({
  exposureQuery,
  dataSource,
  close,
  onSave,
}) => {
  const { apiCall } = useAuth();
  const [id, setId] = useState<string | null>(null);
  const { data, error, mutate } = useApi<{
    dimensionMetadata: DimensionMetadataInterface;
  }>(`/automatic-dimension/${id}`);

  useEffect(() => {
    setExposureId(exposureQuery, dataSource, apiCall, setId, mutate);
  }, [dataSource, exposureQuery, apiCall, mutate, setId]);

  if (error) {
    return <div className="alert alert-error">{error?.message}</div>;
  }
  const { status } = getQueryStatus(
    data?.dimensionMetadata?.queries || [],
    data?.dimensionMetadata?.error
  );

  const saveEnabled = id && status === "succeeded";
  const secondaryCTA = (
    <button
      className={`btn btn-primary`}
      type="submit"
      disabled={!saveEnabled}
      onClick={() => {
        if (id) {
          const value = cloneDeep<ExposureQuery>(exposureQuery);
          value.dimensionMetadataId = id;
          onSave(value);
          close();
        }
      }}
    >
      {"Save Dimension Slices"}
    </button>
  );

  return (
    <>
      <Modal
        open={true}
        close={close}
        secondaryCTA={secondaryCTA}
        size="lg"
        header={"Experiment Dimension Metadata"}
      >
        <div className="my-2 ml-3 mr-3">
          <div className="row mb-1">
            Experiment Dimensions can be configured to have up to 20 pre-defined
            slices per dimension.
          </div>
          <div className="row mb-1">
            <strong>Why?</strong>
            Pre-defining dimension slices allows us to run traffic and health
            checks on your experiment for all bins whenever you update
            experiment results, rather than requiring you to re-run queries for
            each dimension just to check traffic by dimension.
          </div>
          <div className="row mb-2">
            <strong>How?</strong>
            Running the query on this page will scan 30 days of data from your
            experiment assignment query to determine the 20 most popular
            dimension values and will save them for future use. It may be useful
            to update this periodically if you suspect the underlying numbers of
            users in each bucket are changing over time.
          </div>
          <div className="row">
            <DimensionMetadataRunner
              dimensionMetadata={data?.dimensionMetadata}
              status={status}
              id={id}
              setId={setId}
              mutate={mutate}
              dataSource={dataSource}
              exposureQuery={exposureQuery}
            />
          </div>
        </div>
      </Modal>
    </>
  );
};

type DimensionMetadataRunnerProps = {
  dimensionMetadata?: DimensionMetadataInterface;
  status: QueryStatus;
  id: string | null;
  setId: (id: string) => void;
  mutate: () => void;
  dataSource: DataSourceInterfaceWithParams;
  exposureQuery: ExposureQuery;
};

export const DimensionMetadataRunner: FC<DimensionMetadataRunnerProps> = ({
  dimensionMetadata,
  status,
  id,
  setId,
  mutate,
  dataSource,
  exposureQuery,
}) => {
  const { apiCall } = useAuth();
  const [error, setError] = useState<string>("");
  const refreshDimension = useCallback(async () => {
    apiCall<{
      dimensionMetadata: DimensionMetadataInterface;
    }>("/automatic-dimension", {
      method: "POST",
      body: JSON.stringify({
        dataSourceId: dataSource.id,
        queryId: exposureQuery.id,
        lookbackDays: 9999, // TODO configure
      }),
    })
      .then((res) => {
        setId(res.dimensionMetadata.id);
        mutate();
      })
      .catch((e) => {
        setError(e.message);
        console.error(e.message);
      });
  }, [dataSource.id, exposureQuery.id, mutate, apiCall, setId]);

  return (
    <>
      <div className="col-12">
        <div className="col-auto ml-auto">
          <div className="row align-items-center mb-3">
            <div className="col-auto ml-auto">
              <div>
                <strong>Experiment Assignment Query:</strong>{" "}
                {exposureQuery.name}
              </div>
              <div>
                <strong>Dimension Columns: </strong>
                {exposureQuery.dimensions.map((d, i) => (
                  <Fragment key={i}>
                    {i ? ", " : ""}
                    {d}
                  </Fragment>
                ))}
                {!exposureQuery.dimensions.length && (
                  <em className="text-muted">none</em>
                )}
              </div>
            </div>
            <div className="flex-1" />

            <div className="col-auto ml-auto">
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
                  cta={`${
                    dimensionMetadata ? "Refresh" : "Load"
                  } Dimension Slices`}
                  icon={dimensionMetadata ? "refresh" : "run"}
                  position={"left"}
                  mutate={mutate}
                  model={
                    dimensionMetadata ?? { queries: [], runStarted: undefined }
                  }
                  cancelEndpoint={`/automatic-dimension/${id}/cancel`}
                  color="outline-primary"
                />
              </form>
              {dimensionMetadata?.runStarted ? (
                <div
                  className="text-right text-muted"
                  style={{ fontSize: "0.7em" }}
                  title={datetime(dimensionMetadata.runStarted)}
                >
                  last updated {ago(dimensionMetadata.runStarted)}
                </div>
              ) : null}
            </div>
          </div>
        </div>
        {(status === "failed" || error !== "") && dimensionMetadata ? (
          <div className="alert alert-danger mt-2">
            <strong>Error updating data</strong>
            {error ? `: ${error}` : null}
          </div>
        ) : null}
        {dimensionMetadata?.results && dimensionMetadata.results.length ? (
          <DimensionMetadataResults
            dimensionMetadataResult={dimensionMetadata.results}
          />
        ) : (
          <></>
        )}
        {dimensionMetadata?.queries && (
          <div>
            <ViewAsyncQueriesButton
              queries={
                dimensionMetadata.queries?.length > 0
                  ? dimensionMetadata.queries.map((q) => q.query)
                  : []
              }
              error={dimensionMetadata.error}
              inline={true}
              status={status}
            />
          </div>
        )}
      </div>
    </>
  );
};

type DimensionMetadataResultsProps = {
  dimensionMetadataResult: DimensionMetadataResult[];
};

export const DimensionMetadataResults: FC<DimensionMetadataResultsProps> = ({
  dimensionMetadataResult,
}) => {
  return (
    <>
      <div>
        {dimensionMetadataResult.map((r, i) => {
          let totalPercent = 0;
          return (
            <div key={i}>
              <label>
                <h3>{r.dimension}</h3>
                <div>
                  Top dimension slices:{"  "}
                  {r.dimensionValues.map((d, i) => {
                    totalPercent += d.percent;
                    return (
                      <>
                        <Fragment key={`${r.dimension}-${i}`}>
                          {i ? ", " : ""}
                          <code key={`${r.dimension}-${d.name}`}>{d.name}</code>
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
                  <Fragment key={`${r.dimension}--1`}>
                    {" "}
                    <code key={`${r.dimension}-_other_`}>
                      {AUTOMATIC_DIMENSION_OTHER_NAME}
                    </code>
                  </Fragment>
                  <span>{` (${smallPercentFormatter.format(
                    (100.0 - totalPercent) / 100.0
                  )})`}</span>
                </div>
              </label>
            </div>
          );
        })}
      </div>
    </>
  );
};
