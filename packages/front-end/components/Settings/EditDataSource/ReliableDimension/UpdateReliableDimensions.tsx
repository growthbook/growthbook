import React, { FC, Fragment, useCallback, useEffect, useState } from "react";
import {
  DataSourceInterfaceWithParams,
  ExposureQuery,
} from "back-end/types/datasource";
import { useForm } from "react-hook-form";
import cloneDeep from "lodash/cloneDeep";
import { ReliableDimensionInterface } from "back-end/src/types/Integration";
import { ago, datetime } from "shared/dates";
import { useAuth } from "@/services/auth";
import useApi from "@/hooks/useApi";
import RunQueriesButton, {
  getQueryStatus,
} from "@/components/Queries/RunQueriesButton";
import ViewAsyncQueriesButton from "@/components/Queries/ViewAsyncQueriesButton";
import Modal from "../../../Modal";

type UpdateReliableDimensionModalProps = {
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

export const UpdateReliableDimensionsModal: FC<UpdateReliableDimensionModalProps> = ({
  exposureQuery,
  dataSource,
  close,
  onSave,
  //onCancel,
}) => {
  const { apiCall } = useAuth();

  const form = useForm<ExposureQuery>({
    defaultValues: cloneDeep<ExposureQuery>(exposureQuery),
  });
  const [id, setId] = useState<string | null>(null);

  const { data, error, mutate } = useApi<{
    reliableDimension: ReliableDimensionInterface;
  }>(`/reliable-dimension/${id}`);

  const handleSubmit = form.handleSubmit(async (value) => {
    await onSave(value);

    form.reset({
      id: undefined,
      query: "",
      name: "",
      dimensions: [],
      dimensionsForTraffic: [],
      description: "",
      hasNameCol: false,
      userIdType: undefined,
    });
  });

  const getDimensionId = useCallback(async () => {
    try {
      const res = await apiCall<{
        reliableDimension: ReliableDimensionInterface;
      }>(`/reliable-dimension/datasource/${dataSource.id}/${exposureQuery.id}`);
      if (res?.reliableDimension?.id) {
        setId(res.reliableDimension.id);
        await mutate();
      }
    } catch (e) {
      console.error(e);
    }
  }, [dataSource, exposureQuery, apiCall, mutate, setId]);
  useEffect(() => {
    getDimensionId();
  }, [getDimensionId]);
  const { status } = getQueryStatus(
    data?.reliableDimension?.queries || [],
    data?.reliableDimension?.error
  );
  console.log(status);
  console.log(data);
  const refreshDimension = useCallback(async () => {
    const res = await apiCall<{
      reliableDimension: ReliableDimensionInterface;
    }>("/reliable-dimension", {
      method: "POST",
      body: JSON.stringify({
        datasourceId: dataSource.id,
        queryId: exposureQuery.id,
      }),
    });
    await mutate();
    setId(res.reliableDimension.id);
  }, [dataSource, exposureQuery, mutate, apiCall]);

  if (error) {
    return <div className="alert alert-error">{error?.message}</div>;
  }

  return (
    <>
      <Modal
        open={true}
        close={close}
        submit={handleSubmit}
        cta={"Save to Data Source"}
        size="lg"
        header={"Processed Dimension"}
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
                      {data.reliableDimension?.runStarted ? (
                        <div
                          className="text-muted"
                          style={{ fontSize: "0.8em" }}
                          title={datetime(data.reliableDimension.runStarted)}
                        >
                          last updated {ago(data.reliableDimension.runStarted)}
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
                          data.reliableDimension ? "Refresh" : "Load"
                        } Automatic Dimensions`}
                        mutate={mutate}
                        model={data.reliableDimension ?? { queries: [] }}
                        cancelEndpoint={`/metric/1/analysis/cancel` /*TODO*/}
                        color="outline-primary"
                      />
                    </form>{" "}
                  </div>
                  {data?.reliableDimension?.results &&
                  data?.reliableDimension.results.length ? (
                    <UpdateReliableDimensions
                      reliableDimension={data.reliableDimension}
                    />
                  ) : (
                    <></>
                  )}
                  {data?.reliableDimension?.queries && (
                    <div>
                      <ViewAsyncQueriesButton
                        queries={
                          data.reliableDimension.queries?.length > 0
                            ? data.reliableDimension.queries.map((q) => q.query)
                            : []
                        }
                        error={data.reliableDimension.error}
                        inline={true}
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

type UpdateReliableDimensionProps = {
  reliableDimension: ReliableDimensionInterface;
};

export const UpdateReliableDimensions: FC<UpdateReliableDimensionProps> = ({
  reliableDimension,
}) => {
  return (
    <>
      <div>
        {reliableDimension
          ? reliableDimension.results.map((r, i) => {
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
