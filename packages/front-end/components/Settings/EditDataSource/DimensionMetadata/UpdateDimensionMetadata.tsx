import React, { FC, Fragment, useCallback, useEffect, useState } from "react";
import {
  DataSourceInterfaceWithParams,
  ExposureQuery,
} from "back-end/types/datasource";
import cloneDeep from "lodash/cloneDeep";
import { ago, datetime } from "shared/dates";
import { QueryStatus } from "back-end/types/query";
import { AUTOMATIC_DIMENSION_OTHER_NAME } from "shared/constants";
import { DimensionSlicesInterface } from "back-end/types/dimension";
import { BsGear } from "react-icons/bs";
import { useForm } from "react-hook-form";
import { useAuth } from "@/services/auth";
import useApi from "@/hooks/useApi";
import RunQueriesButton, {
  getQueryStatus,
} from "@/components/Queries/RunQueriesButton";
import ViewAsyncQueriesButton from "@/components/Queries/ViewAsyncQueriesButton";
import Modal from "@/components/Modal";
import Field from "@/components/Forms/Field";

const smallPercentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 0,
});

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
  const [id, setId] = useState<string | null>(
    exposureQuery.dimensionSlicesId || null
  );
  const { data, error, mutate } = useApi<{
    dimensionSlices: DimensionSlicesInterface;
  }>(`/dimension-slices/${id}`);

  const dataSourceId = dataSource.id;
  const exposureQueryId = exposureQuery.id;
  const metadataId = exposureQuery.dimensionSlicesId;

  useEffect(() => {
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
  }, [dataSourceId, exposureQueryId, metadataId, setId, apiCall, mutate]);

  if (error) {
    return <div className="alert alert-error">{error?.message}</div>;
  }
  const { status } = getQueryStatus(
    data?.dimensionSlices?.queries || [],
    data?.dimensionSlices?.error
  );

  const saveEnabled = id && status === "succeeded";
  const secondaryCTA = (
    <button
      className={`btn btn-primary`}
      type="submit"
      disabled={!saveEnabled}
      onClick={async () => {
        if (
          id &&
          data?.dimensionSlices?.results &&
          data.dimensionSlices.results.length > 0
        ) {
          const value = cloneDeep<ExposureQuery>(exposureQuery);
          value.dimensionSlicesId = id;
          value.dimensionMetadata = data.dimensionSlices.results.map((r) => ({
            dimension: r.dimension,
            specifiedSlices: r.dimensionSlices.map((dv) => dv.name),
          }));
          await onSave(value);
          close();
        }
      }}
    >
      Save Dimension Slices
    </button>
  );

  return (
    <>
      <Modal
        open={true}
        close={close}
        secondaryCTA={secondaryCTA}
        size="lg"
        header={"Configure Experiment Dimensions"}
      >
        <div className="my-2 ml-3 mr-3">
          <div className="row mb-1">
            Experiment Dimensions can be configured to have up to 20 pre-defined
            slices per dimension.
          </div>
          <div className="row mb-1">
            <strong>Why?</strong>
            Pre-defining dimension slices allows us to automatically run traffic
            and health checks on your experiment for all bins whenever you
            update experiment results.
          </div>
          <div className="row mb-3">
            <strong>How?</strong>
            Running the query on this page will load data using your experiment
            assignment query to determine the 20 most popular dimension slices.
          </div>
          <div className="row">
            <DimensionSlicesRunner
              dimensionSlices={data?.dimensionSlices}
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

type DimensionSlicesRunnerProps = {
  dimensionSlices?: DimensionSlicesInterface;
  status: QueryStatus;
  id: string | null;
  setId: (id: string) => void;
  mutate: () => void;
  dataSource: DataSourceInterfaceWithParams;
  exposureQuery: ExposureQuery;
};

export const DimensionSlicesRunner: FC<DimensionSlicesRunnerProps> = ({
  dimensionSlices,
  status,
  id,
  setId,
  mutate,
  dataSource,
  exposureQuery,
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
        setId(res.dimensionSlices.id);
        mutate();
      })
      .catch((e) => {
        setError(e.message);
        console.error(e.message);
      });
  }, [dataSource.id, exposureQuery.id, form, mutate, apiCall, setId]);

  dimensionSlices?.results;
  return (
    <>
      <div className="col-12">
        <div className="col-auto ml-auto">
          <div className="row align-items-center mb-3">
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
                    dimensionSlices ? "Refresh" : "Query"
                  } Dimension Slices`}
                  icon={dimensionSlices ? "refresh" : "run"}
                  position={"left"}
                  mutate={mutate}
                  model={
                    dimensionSlices ?? { queries: [], runStarted: undefined }
                  }
                  cancelEndpoint={`/dimension-slices/${id}/cancel`}
                  color={`${dimensionSlices ? "outline-" : ""}primary`}
                />
              </form>
              {dimensionSlices?.runStarted ? (
                <div
                  className="text-right text-muted"
                  style={{ fontSize: "0.7em" }}
                  title={datetime(dimensionSlices.runStarted)}
                >
                  last updated {ago(dimensionSlices.runStarted)}
                </div>
              ) : null}
              <div
                className="text-right text-muted"
                style={{ fontSize: "0.7em" }}
              >
                {openLookbackField ? (
                  <div className="form-inline">
                    <Field
                      type="number"
                      className=""
                      label="Days to look back"
                      {...form.register("lookbackDays", {
                        valueAsNumber: true,
                        min: 1,
                      })}
                    />
                  </div>
                ) : (
                  <span>{form.getValues("lookbackDays")} day lookback </span>
                )}
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    setOpenLookbackField(!openLookbackField);
                  }}
                >
                  <BsGear />
                </a>
              </div>
            </div>
          </div>
        </div>
        {(status === "failed" || error !== "") && dimensionSlices ? (
          <div className="alert alert-danger mt-2">
            <strong>Error updating data</strong>
            {`: ${error || "See View Queries below"}`}
          </div>
        ) : null}
        {status === "succeeded" && dimensionSlices?.results.length === 0 ? (
          <div className="alert alert-warning mt-2">
            <strong>No experiment assignment rows found in data source.</strong>
          </div>
        ) : null}
        <DimensionSlicesResults
          status={status}
          dimensions={exposureQuery.dimensions}
          dimensionSlices={dimensionSlices}
        />

        {dimensionSlices?.queries && (
          <div>
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
          </div>
        )}
      </div>
    </>
  );
};

type DimensionSlicesProps = {
  status: string;
  dimensions: string[];
  dimensionSlices?: DimensionSlicesInterface;
};

export const DimensionSlicesResults: FC<DimensionSlicesProps> = ({
  dimensions,
  dimensionSlices,
  status,
}) => {
  return (
    <>
      <table className="table appbox gbtable mt-2 mb-0">
        <thead>
          <tr>
            <th>Dimension</th>
            <th>Pre-defined Slices (% of Units)</th>
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
                                <code key={`${r}-${d.name}`}>{d.name}</code>
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
                          <code key={`${r}-_other_`}>
                            {AUTOMATIC_DIMENSION_OTHER_NAME}
                          </code>
                        </Fragment>
                        <span>{` (${smallPercentFormatter.format(
                          (100.0 - totalPercent) / 100.0
                        )})`}</span>
                      </div>
                    </>
                  ) : status !== "running" ? (
                    <div className="text-muted">
                      Run dimension slices query to populate...
                    </div>
                  ) : (
                    <div className="text-muted">Updating data...</div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
};
