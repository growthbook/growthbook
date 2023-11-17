import React, { FC, useCallback, useEffect, useMemo, useState } from "react";
import {
  DataSourceInterfaceWithParams,
  ExposureQuery,
} from "back-end/types/datasource";
import { UseFormReturn, useForm } from "react-hook-form";
import cloneDeep from "lodash/cloneDeep";
import uniqId from "uniqid";
import { FaExclamationTriangle, FaExternalLinkAlt, FaPlay } from "react-icons/fa";
import { ReliableDimensionInterface, TestQueryRow } from "back-end/src/types/Integration";
import { useFeatureIsOn } from "@growthbook/growthbook-react";
import Code from "@/components/SyntaxHighlighting/Code";
import StringArrayField from "@/components/Forms/StringArrayField";
import Toggle from "@/components/Forms/Toggle";
import Tooltip from "@/components/Tooltip/Tooltip";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import { AppFeatures } from "@/types/app-features";
import { useUser } from "@/services/UserContext";
import Modal from "../../../Modal";
import Field from "../../../Forms/Field";
import EditSqlModal from "../../../SchemaBrowser/EditSqlModal";
import { useAuth } from "@/services/auth";
import useApi from "@/hooks/useApi";
import RunQueriesButton from "@/components/Queries/RunQueriesButton";
import LoadingOverlay from "@/components/LoadingOverlay";
import { set } from "lodash";
import Button from "@/components/Button";

type UpdateReliableDimensionModalProps = {
  exposureQuery: ExposureQuery;
  dataSource: DataSourceInterfaceWithParams;
  close: () => void;
  onSave: (exposureQuery: ExposureQuery) => void;
  //id: string;
  //onCancel: () => void;
};

export const UpdateReliableDimensionsModal: FC<UpdateReliableDimensionModalProps> = ({
  exposureQuery,
  dataSource,
  close,
  onSave,
  //onCancel,
}) => {

  const { apiCall } = useAuth();
  const [id, setId] = useState<string | null>(null);

  const getDimensionId = async () => {
    try {
      console.log(dataSource.id);
      console.log(exposureQuery.id);
      const res = await apiCall<{ reliableDimension: ReliableDimensionInterface }>(
        `/reliable-dimension/datasource/${dataSource.id}/${exposureQuery.id}`);
      console.log("getdimensionid res")
      console.log(res)
      if (res?.reliableDimension?.id) {
        setId(res.reliableDimension.id);
      }
    } catch (e) {
      console.error(e);
    }
  };
  useEffect(() => {
    getDimensionId();
  }, []);
  console.log("id");
  console.log(id);

  const { data, error, mutate } = useApi<{ reliableDimension: ReliableDimensionInterface }>(
    `/reliable-dimension/${id}`);

  const refreshDimension = useCallback(async () => {
    const res = await apiCall<{ reliableDimension: ReliableDimensionInterface }>("/reliable-dimension", {
      method: "POST",
      body: JSON.stringify({
        datasourceId: dataSource.id,
        queryId: exposureQuery.id
      }),
    });
    console.log("res")
    console.log(res)
    setId(res.reliableDimension.id)
    await mutate();
}, [])
  console.log("data"); 
  console.log(data);

  if (error) {
    return <div className="alert alert-error">{error?.message}</div>;
  }
  if (data?.reliableDimension === null) {

  }
  return (
  <>
    <Modal
      open={true}
      close={close}
      size="lg"
      header={"Processed Dimension"}
    >
      <div className="my-2 ml-3 mr-3">
        <div className="row">
          <div className="col-12">
            {!data ? <LoadingOverlay></LoadingOverlay>:          data.reliableDimension && (
          <form
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  refreshDimension()
                  console.log(data);
                } catch (e) {
                  console.error(e);
                }
              }}
            >
    <RunQueriesButton
      cta={"Refresh Automatic Dimensions"}
      mutate={mutate}
      model={data.reliableDimension}
      cancelEndpoint={`/metric/1/analysis/cancel`}
      color="outline-primary"
    />
    </form> )}
  {data?.reliableDimension?.results && data?.reliableDimension.results.length && (
            <UpdateReliableDimensions
              reliableDimension={data.reliableDimension}
              exposureQuery={exposureQuery}
            />
            )}
            </div>
        </div>
      </div>
    </Modal>
  </>);
}


type UpdateReliableDimensionProps = {
  reliableDimension: ReliableDimensionInterface
  exposureQuery: ExposureQuery
  //onCancel: () => void;
};

export const UpdateReliableDimensions: FC<UpdateReliableDimensionProps> = ({
  reliableDimension,
  exposureQuery
}) => {
  const form = useForm<ExposureQuery>({
    defaultValues: cloneDeep<ExposureQuery>(exposureQuery)
  });
  const selectedDimensions = form.getValues("processedDimensions") ?? [];
  const setSelectedDimensions = useCallback((
    dim: string, selected: boolean
  ) => {
    if (selectedDimensions.includes(dim) && !selected) {
      form.setValue("processedDimensions", selectedDimensions.filter((d) => d !== dim))
    } else if (!selectedDimensions.includes(dim) && selected) {
      selectedDimensions.push(dim)
      form.setValue("processedDimensions", selectedDimensions)
    }
  }, [
    form,
    selectedDimensions
  ])

  return (<>
  <div>
  {reliableDimension ? 
    reliableDimension.results.map((r, i) => (
      <div key={i}>
        <label>
        <input
          type="checkbox"
          className={`form-check-input`}
          checked={selectedDimensions.includes(r.dimension)}
          onChange={(e) => setSelectedDimensions(r.dimension, e.target.checked)}
        />
        <div>{r.dimension}</div>
        <div>{r.dimensionValues.join(", ")}</div>
        <div>{r.sql}</div>
      </label>

      </div>
    )): null}
    </div>
  </>);
}