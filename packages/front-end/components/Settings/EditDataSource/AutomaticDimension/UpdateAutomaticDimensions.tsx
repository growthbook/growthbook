import React, { FC, Fragment, useCallback, useEffect, useState } from "react";
import {
  DataSourceInterfaceWithParams,
  ExposureQuery,
} from "back-end/types/datasource";
import cloneDeep from "lodash/cloneDeep";
import {
  AutomaticDimensionInterface,
  AutomaticDimensionResult,
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
  if (exposureQuery.automaticDimensionId) {
    setId(exposureQuery.automaticDimensionId);
    await mutate();
  } else {
    try {
      const res = await apiCall<{
        automaticDimension: AutomaticDimensionInterface;
      }>(
        `/automatic-dimension/datasource/${dataSource.id}/${exposureQuery.id}`
      );
      if (res?.automaticDimension?.id) {
        setId(res.automaticDimension.id);
        await mutate();
      }
    } catch (e) {
      console.error(e);
    }
  }
}

type UpdateAutomaticDimensionModalProps = {
  exposureQuery: ExposureQuery;
  dataSource: DataSourceInterfaceWithParams;
  close: () => void;
  onSave: (exposureQuery: ExposureQuery) => void;
};

export const UpdateAutomaticDimensionsModal: FC<UpdateAutomaticDimensionModalProps> = ({
  exposureQuery,
  dataSource,
  close,
  onSave,
}) => {
  const { apiCall } = useAuth();
  const [id, setId] = useState<string | null>(null);
  const { data, error, mutate } = useApi<{
    automaticDimension: AutomaticDimensionInterface;
  }>(`/automatic-dimension/${id}`);

  useEffect(() => {
    setExposureId(exposureQuery, dataSource, apiCall, setId, mutate);
  }, [dataSource, exposureQuery, apiCall, mutate, setId]);

  if (error) {
    return <div className="alert alert-error">{error?.message}</div>;
  }
  const { status } = getQueryStatus(
    data?.automaticDimension?.queries || [],
    data?.automaticDimension?.error
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
          value.automaticDimensionId = id;
          onSave(value);
          close();
        }
      }}
    >
      {"Save to Data Source"}
    </button>
  );

  return (
    <>
      <Modal
        open={true}
        close={close}
        secondaryCTA={secondaryCTA}
        size="max"
        sizeY="max"
        header={"Automatic Dimensions"}
      >
        <div className="my-2 ml-3 mr-3">
          <div className="row">
            <AutomaticDimensionRunner
              automaticDimension={data?.automaticDimension}
              status={status}
              id={id}
              setId={setId}
              mutate={mutate}
              dataSourceId={dataSource.id}
              exposureQueryId={exposureQuery.id}
            />
          </div>
        </div>
      </Modal>
    </>
  );
};

type AutomaticDimensionRunnerProps = {
  automaticDimension?: AutomaticDimensionInterface;
  status: QueryStatus;
  id: string | null;
  setId: (id: string) => void;
  mutate: () => void;
  dataSourceId: string;
  exposureQueryId: string;
};

export const AutomaticDimensionRunner: FC<AutomaticDimensionRunnerProps> = ({
  automaticDimension,
  status,
  id,
  setId,
  mutate,
  dataSourceId,
  exposureQueryId,
}) => {
  const { apiCall } = useAuth();
  const refreshDimension = useCallback(async () => {
    apiCall<{
      automaticDimension: AutomaticDimensionInterface;
    }>("/automatic-dimension", {
      method: "POST",
      body: JSON.stringify({
        dataSourceId: dataSourceId,
        queryId: exposureQueryId,
        lookbackDays: 9999, // TODO configure
      }),
    })
      .then((res) => {
        setId(res.automaticDimension.id);
        mutate();
      })
      .catch((e) => {
        console.error(e.message);
      });
  }, [dataSourceId, exposureQueryId, mutate, apiCall, setId]);

  return (
    <>
      <div className="col-12">
        <div className="row align-items-center mb-4">
          <div className="col-auto ml-auto">
            {automaticDimension?.runStarted ? (
              <div
                className="text-muted"
                style={{ fontSize: "0.8em" }}
                title={datetime(automaticDimension.runStarted)}
              >
                last updated {ago(automaticDimension.runStarted)}
              </div>
            ) : null}
          </div>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                refreshDimension();
              } catch (e) {
                console.error(e);
              }
            }}
          >
            <RunQueriesButton
              cta={`${
                automaticDimension ? "Refresh" : "Create"
              } Automatic Dimensions`}
              icon={automaticDimension ? "refresh" : "run"}
              mutate={mutate}
              model={
                automaticDimension ?? { queries: [], runStarted: undefined }
              }
              cancelEndpoint={`/automatic-dimension/${id}/cancel`}
              color="outline-primary"
            />
          </form>{" "}
          {status === "failed" && automaticDimension && (
            <div className="alert alert-danger mt-2">
              <strong>
                Error updating data, reverting to last valid automatic
                dimensions.
              </strong>
            </div>
          )}
        </div>
        {automaticDimension?.results && automaticDimension.results.length ? (
          <AutomaticDimensionResults
            automaticDimensionResult={automaticDimension.results}
          />
        ) : (
          <></>
        )}
        {automaticDimension?.queries && (
          <div>
            <ViewAsyncQueriesButton
              queries={
                automaticDimension.queries?.length > 0
                  ? automaticDimension.queries.map((q) => q.query)
                  : []
              }
              error={automaticDimension.error}
              inline={true}
              status={status}
            />
          </div>
        )}
      </div>
    </>
  );
};

type AutomaticDimensionResultsProps = {
  automaticDimensionResult: AutomaticDimensionResult[];
};

export const AutomaticDimensionResults: FC<AutomaticDimensionResultsProps> = ({
  automaticDimensionResult,
}) => {
  return (
    <>
      <div>
        {automaticDimensionResult.map((r, i) => {
          let totalPercent = 0;
          return (
            <div key={i}>
              <label>
                <h4>{r.dimension}</h4>
                <div>
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
                  other values:
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
