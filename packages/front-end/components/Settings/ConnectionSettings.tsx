import { DataSourceInterfaceWithParams } from "shared/types/datasource";
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
import SharedConnectionSettings from "./SharedConnectionSettings";

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
  // Set the new params (specific per-datasource) and optionally settings (shared between datasources)
  const setParams = (
    params: { [key: string]: string },
    settings: { [key: string]: string } = {},
  ) => {
    const newVal = {
      ...datasource,
      params: {
        ...datasource.params,
        ...params,
      },
      settings: {
        ...datasource.settings,
        ...settings,
      },
    };

    setDatasource(newVal as Partial<DataSourceInterfaceWithParams>);
    setDirty && setDirty(true);
  };
  const onParamChange: ChangeEventHandler<HTMLInputElement> = (e) => {
    setParams({ [e.target.name]: e.target.value });
  };
  const onSettingChange: ChangeEventHandler<HTMLInputElement> = (e) => {
    setParams({}, { [e.target.name]: e.target.value });
  };
  const onManualParamChange = (name, value) => {
    setParams({ [name]: value });
  };

  if (!datasource.type) return null;

  let invalidType: never;
  let datasourceComponent = <></>;
  switch (datasource.type) {
    case "growthbook_clickhouse":
      // The in-built datastore does not have editable settings
      break;
    case "athena":
      datasourceComponent = (
        <AthenaForm
          existing={existing}
          onParamChange={onParamChange}
          params={datasource?.params || {}}
          setParams={setParams}
        />
      );
      break;
    case "presto":
      datasourceComponent = (
        <PrestoForm
          existing={existing}
          onParamChange={onParamChange}
          onManualParamChange={onManualParamChange}
          setParams={setParams}
          params={datasource?.params || {}}
        />
      );
      break;
    case "databricks":
      datasourceComponent = (
        <DatabricksForm
          existing={existing}
          onParamChange={onParamChange}
          setParams={setParams}
          params={datasource?.params || {}}
        />
      );
      break;
    case "redshift":
      datasourceComponent = (
        <PostgresForm
          existing={existing}
          onParamChange={onParamChange}
          setParams={setParams}
          params={datasource?.params || {}}
        />
      );
      break;
    case "postgres":
      datasourceComponent = (
        <PostgresForm
          existing={existing}
          onParamChange={onParamChange}
          setParams={setParams}
          params={datasource?.params || {}}
        />
      );
      break;
    case "vertica":
      datasourceComponent = (
        <PostgresForm
          existing={existing}
          onParamChange={onParamChange}
          setParams={setParams}
          params={datasource?.params || {}}
        />
      );
      break;
    case "mysql":
      datasourceComponent = (
        <MysqlForm
          existing={existing}
          onParamChange={onParamChange}
          setParams={setParams}
          params={datasource?.params || {}}
        />
      );
      break;
    case "mssql":
      datasourceComponent = (
        <MssqlForm
          existing={existing}
          onParamChange={onParamChange}
          setParams={setParams}
          params={datasource?.params || {}}
        />
      );
      break;
    case "google_analytics":
      datasourceComponent = (
        <GoogleAnalyticsForm
          existing={existing}
          onParamChange={onParamChange}
          setParams={setParams}
          params={datasource?.params || {}}
          error={hasError}
          projects={datasource?.projects || []}
        />
      );
      break;
    case "snowflake":
      datasourceComponent = (
        <SnowflakeForm
          existing={existing}
          onParamChange={onParamChange}
          onManualParamChange={onManualParamChange}
          params={datasource?.params || {}}
        />
      );
      break;
    case "clickhouse":
      datasourceComponent = (
        <ClickHouseForm
          existing={existing}
          onParamChange={onParamChange}
          setParams={setParams}
          params={datasource?.params || {}}
        />
      );
      break;
    case "bigquery":
      datasourceComponent = (
        <BigQueryForm
          existing={existing}
          setParams={setParams}
          params={datasource?.params || {}}
          onParamChange={onParamChange}
        />
      );
      break;
    case "mixpanel":
      datasourceComponent = (
        <MixpanelForm
          existing={existing}
          onParamChange={onParamChange}
          onManualParamChange={onManualParamChange}
          params={datasource?.params || {}}
        />
      );
      break;
    default:
      invalidType = datasource.type;
      throw `Invalid type: ${invalidType}`;
  }
  return (
    <>
      {datasourceComponent}
      <SharedConnectionSettings
        onSettingChange={onSettingChange}
        settings={datasource?.settings || {}}
      />
    </>
  );
}
