import React, { FC, Fragment, useCallback, useEffect, useState } from "react";
import {
  DataSourceInterfaceWithParams,
  ExposureQuery,
} from "back-end/types/datasource";
import { useForm } from "react-hook-form";
import cloneDeep from "lodash/cloneDeep";
import { AutomaticDimensionInterface } from "back-end/src/types/Integration";
import { ago, datetime } from "shared/dates";
import { useAuth } from "@/services/auth";
import useApi from "@/hooks/useApi";
import RunQueriesButton, {
  getQueryStatus,
} from "@/components/Queries/RunQueriesButton";
import ViewAsyncQueriesButton from "@/components/Queries/ViewAsyncQueriesButton";
import Modal from "../../../Modal";
import Tooltip from "@/components/Tooltip/Tooltip";

type UpdateAutomaticDimensionModalProps = {
  exposureQuery: ExposureQuery;
  dataSource: DataSourceInterfaceWithParams;
  close: () => void;
  onSave: (exposureQuery: ExposureQuery) => void;
  //id: string;
  //onCancel: () => void;
};
const smallPercentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 0,
});

export const UpdateAutomaticDimensionsModal: FC<UpdateAutomaticDimensionModalProps> = ({
  exposureQuery,
  dataSource,
  close,
  onSave,
  //onCancel,
}) => {
  const { apiCall } = useAuth();
  const [id, setId] = useState<string | null>(null);
  const { data, error, mutate } = useApi<{
    automaticDimension: AutomaticDimensionInterface;
  }>(`/automatic-dimension/${id}`);

  const getDimensionId = useCallback(async () => {
    if (exposureQuery.processedDimensionsId) {
      setId(exposureQuery.processedDimensionsId);
      await mutate();
    } else {
      try {
        const res = await apiCall<{
          automaticDimension: AutomaticDimensionInterface;
        }>(`/automatic-dimension/datasource/${dataSource.id}/${exposureQuery.id}`);
        if (res?.automaticDimension?.id) {
          setId(res.automaticDimension.id);
          await mutate();
        }
      } catch (e) {
        console.error(e);
      }
    }
  }, [dataSource, exposureQuery, apiCall, mutate, setId]);

  useEffect(() => {
    getDimensionId();
  }, [getDimensionId]);

  const { status } = getQueryStatus(
    data?.automaticDimension?.queries || [],
    data?.automaticDimension?.error
  );

  const refreshDimension = useCallback(async () => {
    apiCall<{
      automaticDimension: AutomaticDimensionInterface;
    }>("/automatic-dimension", {
      method: "POST",
      body: JSON.stringify({
        datasourceId: dataSource.id,
        queryId: exposureQuery.id,
      }),
    }).then((res) => {
      setId(res.automaticDimension.id);
      mutate();
    })
    .catch((e) => {
      console.error(e.message);
    });
  }, [dataSource, exposureQuery, mutate, apiCall]);

  if (error) {
    return <div className="alert alert-error">{error?.message}</div>;
  }

  const saveEnabled = id && status === "succeeded";
  const secondaryCTA = <>
      <Tooltip
        body={""}
        shouldDisplay={true}
        tipPosition="top"
      >
        <button
          className={`btn btn-primary`}
          type="submit"
          disabled={!saveEnabled}
          onClick={() => {
            if (id) {
              const value = cloneDeep<ExposureQuery>(exposureQuery);
              value.processedDimensionsId = id;
              onSave(value);
              close();
            }
          }}
        >
          {"Save to Data Source"}
        </button>
      </Tooltip>
  </>;

  return (
    <>
      <Modal
        open={true}
        close={close}
        secondaryCTA={secondaryCTA}
        size="lg"
        header={"Automatic Dimensions"}
      >
        <div className="my-2 ml-3 mr-3">
          <div className="row">
            {!data ? (
              <></>
            ) : (
              <>
                <div className="col-12">
                  <div className="row align-items-center mb-4">
                    <div className="col-auto ml-auto">
                      {data.automaticDimension?.runStarted ? (
                        <div
                          className="text-muted"
                          style={{ fontSize: "0.8em" }}
                          title={datetime(data.automaticDimension.runStarted)}
                        >
                          last updated {ago(data.automaticDimension.runStarted)}
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
                          data.automaticDimension ? "Refresh" : "Create"
                        } Automatic Dimensions`}
                        icon={data.automaticDimension ? "refresh" :"run"}
                        mutate={mutate}
                        model={data.automaticDimension ?? { queries: [] }}
                        cancelEndpoint={`/automatic-dimension/${id}/cancel`}
                        color="outline-primary"
                      />
                    </form>{" "}
                    {status === "failed" && data.automaticDimension && (
        <div className="alert alert-danger mt-2">
          <strong>Error updating data, reverting to last valid dimension slices.</strong>
        </div>
      )}
                  </div>
                  {data?.automaticDimension?.results &&
                  data?.automaticDimension.results.length ? (
                    <UpdateAutomaticDimensions
                      automaticDimension={data.automaticDimension}
                    />
                  ) : (
                    <></>
                  )}
                  {data?.automaticDimension?.queries && (
                    <div>
                      <ViewAsyncQueriesButton
                        queries={
                          data.automaticDimension.queries?.length > 0
                            ? data.automaticDimension.queries.map((q) => q.query)
                            : []
                        }
                        error={data.automaticDimension.error}
                        inline={true}
                        status={status}
                      />
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </Modal>
    </>
  );
};

type UpdateAutomaticDimensionProps = {
  automaticDimension: AutomaticDimensionInterface;
};

export const UpdateAutomaticDimensions: FC<UpdateAutomaticDimensionProps> = ({
  automaticDimension,
}) => {
  return (
    <>
      <div>
        {automaticDimension
          ? automaticDimension.results.map((r, i) => {
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
                              <code key={`${r.dimension}-${d.name}`}>
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
                      other values:
                      <Fragment key={`${r.dimension}--1`}>
                        {" "}
                        <code key={`${r.dimension}-_other_`}>{"_other"}</code>
                      </Fragment>
                      <span>{` (${smallPercentFormatter.format(
                        (100.0 - totalPercent) / 100.0
                      )})`}</span>
                    </div>
                  </label>
                </div>
              );
            })
          : null}
      </div>
    </>
  );
};
