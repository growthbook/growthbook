import { InformationSchemaInterface } from "@/../back-end/src/types/Integration";
import { DataSourceInterfaceWithParams } from "@/../back-end/types/datasource";
import React from "react";
import LoadingOverlay from "./LoadingOverlay";

type Props = {
  datasource: DataSourceInterfaceWithParams;
  informationSchema: InformationSchemaInterface;
};

export default function DatasourceSchema({
  datasource,
  informationSchema,
}: Props) {
  if (!datasource || !informationSchema) {
    return <LoadingOverlay />;
  }

  console.log("informationSchema.databases", informationSchema.databases);
  return (
    <div className="col-sm">
      <label className="font-weight-bold mb-1">{datasource.name}</label>
      <div className="p-1 border rounded">
        <h1>{datasource.name}</h1>
      </div>
    </div>
  );
}
