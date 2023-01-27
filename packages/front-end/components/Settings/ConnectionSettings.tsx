import { DataSourceInterfaceWithParams } from "back-end/types/datasource";
import { ChangeEventHandler } from "react";
import AthenaForm from "./AthenaForm";
import BigQueryForm from "./BigQueryForm";
import ClickHouseForm from "./ClickHouseForm";
import GoogleAnalyticsForm from "./GoogleAnalyticsForm";
import MixpanelForm from "./MixpanelForm";
import MysqlForm from "./MysqlForm";
import PostgresForm from "./PostgresForm";
import PrestoForm from "./PrestoForm";
import SnowflakeForm from "./SnowflakeForm";
import MssqlForm from "./MssqlForm";
import DatabricksForm from "./DatabricksForm";

export interface Props {
  datasource: Partial<DataSourceInterfaceWithParams>;
  existing: boolean;
  hasError: boolean;
  setDirty?: (dirty: boolean) => void;
  setDatasource: (newVal: Partial<DataSourceInterfaceWithParams>) => void;
}

export default function ConnectionSettings({
  datasource,
  existing,
  setDatasource,
  setDirty,
  hasError,
}: Props) {
  const setParams = (params: { [key: string]: string }) => {
    const newVal = {
      ...datasource,
      params: {
        ...datasource.params,
        ...params,
      },
    };

    setDatasource(newVal as Partial<DataSourceInterfaceWithParams>);
    setDirty && setDirty(true);
  };
  const onParamChange: ChangeEventHandler<HTMLInputElement> = (e) => {
    setParams({ [e.target.name]: e.target.value });
  };
  const onManualParamChange = (name, value) => {
    setParams({ [name]: value });
  };

  if (datasource.type === "athena") {
    return (
      <AthenaForm
        existing={existing}
        onParamChange={onParamChange}
        params={datasource.params}
        setParams={setParams}
      />
    );
  } else if (datasource.type === "presto") {
    return (
      <PrestoForm
        existing={existing}
        onParamChange={onParamChange}
        onManualParamChange={onManualParamChange}
        setParams={setParams}
        params={datasource.params}
      />
    );
  } else if (datasource.type === "databricks") {
    return (
      <DatabricksForm
        existing={existing}
        onParamChange={onParamChange}
        setParams={setParams}
        params={datasource.params}
      />
    );
  } else if (datasource.type === "redshift") {
    return (
      <PostgresForm
        existing={existing}
        onParamChange={onParamChange}
        setParams={setParams}
        params={datasource.params}
      />
    );
  } else if (datasource.type === "postgres") {
    return (
      <PostgresForm
        existing={existing}
        onParamChange={onParamChange}
        setParams={setParams}
        params={datasource.params}
      />
    );
  } else if (datasource.type === "mysql") {
    return (
      <MysqlForm
        existing={existing}
        onParamChange={onParamChange}
        setParams={setParams}
        params={datasource.params}
      />
    );
  } else if (datasource.type === "mssql") {
    return (
      <MssqlForm
        existing={existing}
        onParamChange={onParamChange}
        setParams={setParams}
        params={datasource.params}
      />
    );
  } else if (datasource.type === "google_analytics") {
    return (
      <GoogleAnalyticsForm
        existing={existing}
        onParamChange={onParamChange}
        setParams={setParams}
        params={datasource.params}
        error={hasError}
      />
    );
  } else if (datasource.type === "snowflake") {
    return (
      <SnowflakeForm
        existing={existing}
        onParamChange={onParamChange}
        params={datasource.params}
      />
    );
  } else if (datasource.type === "clickhouse") {
    return (
      <ClickHouseForm
        existing={existing}
        onParamChange={onParamChange}
        setParams={setParams}
        params={datasource.params}
      />
    );
  } else if (datasource.type === "bigquery") {
    return (
      <BigQueryForm
        setParams={setParams}
        params={datasource.params}
        onParamChange={onParamChange}
      />
    );
  } else if (datasource.type === "mixpanel") {
    return (
      <MixpanelForm
        existing={existing}
        onParamChange={onParamChange}
        onManualParamChange={onManualParamChange}
        params={datasource.params}
      />
    );
  }
}
