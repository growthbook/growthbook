import { DataSourceInterfaceWithParams } from "shared/types/datasource";
import { ChangeEventHandler, ReactNode, useEffect, useState } from "react";
import { Box } from "@radix-ui/themes";
import { isCloud } from "@/services/env";
import Collapse, { CollapseTrigger } from "@/ui/Collapse";
import AthenaForm from "./AthenaForm";
import BigQueryForm, { BigQueryAdvancedSettings } from "./BigQueryForm";
import ClickHouseForm from "./ClickHouseForm";
import GoogleAnalyticsForm from "./GoogleAnalyticsForm";
import MixpanelForm from "./MixpanelForm";
import MysqlForm from "./MysqlForm";
import PostgresForm from "./PostgresForm";
import PrestoForm from "./PrestoForm";
import SnowflakeForm, { KeyPairGenerator } from "./SnowflakeForm";
import MssqlForm from "./MssqlForm";
import DatabricksForm from "./DatabricksForm";
import AdobeExperiencePlatformQueryServiceForm from "./AdobeExperiencePlatformQueryServiceForm";
import SharedConnectionSettings from "./SharedConnectionSettings";

export interface Props {
  datasource: Partial<DataSourceInterfaceWithParams>;
  existing: boolean;
  hasError: boolean;
  setDirty?: (dirty: boolean) => void;
  setDatasource: (newVal: Partial<DataSourceInterfaceWithParams>) => void;
  beforeAdvancedSettings?: ReactNode;
  /** Rendered at the top of Advanced Settings. */
  advancedSettingsPrefix?: ReactNode;
  /** Open Advanced Settings now, and again if this becomes true later. */
  expandAdvancedSettings?: boolean;
  /** Shown next to the trigger while closed, e.g. the current Project scope. */
  advancedSettingsSummary?: ReactNode;
  /**
   * Collect credentials only. The connection test lives outside this form and
   * no SQL is generated on save, so BigQuery hides its Default Dataset field
   * and inline Test Connection button.
   */
  connectionOnly?: boolean;
  /** Snowflake only: offer to generate the key pair instead of uploading one. */
  keyPairGenerator?: KeyPairGenerator;
  /** Snowflake Event Forwarder: the schema lives on the Event Destination. */
  hideSnowflakeSchema?: boolean;
  /** Password-authenticated warehouses get a generated password on create. */
  generatedPassword?: boolean;
}

export default function ConnectionSettings({
  datasource,
  existing,
  setDatasource,
  setDirty,
  hasError,
  beforeAdvancedSettings,
  advancedSettingsPrefix,
  expandAdvancedSettings = false,
  advancedSettingsSummary,
  connectionOnly = false,
  keyPairGenerator,
  hideSnowflakeSchema = false,
  generatedPassword = false,
}: Props) {
  const bigQueryParams =
    datasource.type === "bigquery" ? datasource.params : undefined;
  const [advancedOpen, setAdvancedOpen] = useState(
    expandAdvancedSettings ||
      !!datasource.settings?.maxConcurrentQueries ||
      !!datasource.settings?.queryCacheTTLMins ||
      !!bigQueryParams?.apiEndpoint ||
      !!bigQueryParams?.reservation ||
      (!!bigQueryParams?.defaultProject &&
        bigQueryParams.defaultProject !== bigQueryParams.projectId),
  );
  useEffect(() => {
    if (expandAdvancedSettings) setAdvancedOpen(true);
  }, [expandAdvancedSettings]);

  // Set the new params (specific per-datasource) and optionally settings (shared between datasources)
  const setParams = (
    params: { [key: string]: string | boolean },
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

  // A decryption failure blanks every param, so there is nothing to keep and
  // the credentials have to be re-entered.
  const storedCredentials = existing && !datasource.decryptionError;

  let invalidType: never;
  let datasourceComponent = <></>;
  switch (datasource.type) {
    case "growthbook_clickhouse":
      // The in-built datastore does not have editable settings
      break;
    case "athena":
      datasourceComponent = (
        <AthenaForm
          existing={storedCredentials}
          onParamChange={onParamChange}
          params={datasource?.params || {}}
          setParams={setParams}
        />
      );
      break;
    case "presto":
      datasourceComponent = (
        <PrestoForm
          existing={storedCredentials}
          onParamChange={onParamChange}
          onManualParamChange={onManualParamChange}
          setParams={setParams}
          params={datasource?.params || {}}
          showAllowlist={!connectionOnly}
        />
      );
      break;
    case "databricks":
      datasourceComponent = (
        <DatabricksForm
          existing={storedCredentials}
          onParamChange={onParamChange}
          setParams={setParams}
          params={datasource?.params || {}}
          showAllowlist={!connectionOnly}
        />
      );
      break;
    case "redshift":
      datasourceComponent = (
        <PostgresForm
          existing={storedCredentials}
          onParamChange={onParamChange}
          setParams={setParams}
          params={datasource?.params || {}}
          generatedPassword={generatedPassword}
          showAllowlist={!connectionOnly}
        />
      );
      break;
    case "postgres":
      datasourceComponent = (
        <PostgresForm
          existing={storedCredentials}
          onParamChange={onParamChange}
          setParams={setParams}
          params={datasource?.params || {}}
          generatedPassword={generatedPassword}
          showAllowlist={!connectionOnly}
        />
      );
      break;
    case "vertica":
      datasourceComponent = (
        <PostgresForm
          existing={storedCredentials}
          onParamChange={onParamChange}
          setParams={setParams}
          params={datasource?.params || {}}
          showAllowlist={!connectionOnly}
        />
      );
      break;
    case "mysql":
      datasourceComponent = (
        <MysqlForm
          existing={storedCredentials}
          onParamChange={onParamChange}
          setParams={setParams}
          params={datasource?.params || {}}
          generatedPassword={generatedPassword}
          showAllowlist={!connectionOnly}
        />
      );
      break;
    case "mssql":
      datasourceComponent = (
        <MssqlForm
          existing={storedCredentials}
          onParamChange={onParamChange}
          setParams={setParams}
          params={datasource?.params || {}}
          generatedPassword={generatedPassword}
          showAllowlist={!connectionOnly}
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
          existing={storedCredentials}
          onParamChange={onParamChange}
          onManualParamChange={onManualParamChange}
          setParams={setParams}
          params={datasource?.params || {}}
          keyPairGenerator={keyPairGenerator}
          hideSchema={hideSnowflakeSchema}
        />
      );
      break;
    case "clickhouse":
      datasourceComponent = (
        <ClickHouseForm
          existing={storedCredentials}
          onParamChange={onParamChange}
          setParams={setParams}
          params={datasource?.params || {}}
          showAllowlist={!connectionOnly}
        />
      );
      break;
    case "bigquery":
      datasourceComponent = (
        <BigQueryForm
          existing={storedCredentials}
          datasourceId={storedCredentials ? datasource.id : undefined}
          projects={datasource.projects}
          setParams={setParams}
          params={datasource?.params || {}}
          onParamChange={onParamChange}
          connectionOnly={connectionOnly}
        />
      );
      break;
    case "mixpanel":
      datasourceComponent = (
        <MixpanelForm
          existing={storedCredentials}
          onParamChange={onParamChange}
          onManualParamChange={onManualParamChange}
          params={datasource?.params || {}}
        />
      );
      break;
    case "adobe_experience_platform_query_service":
      datasourceComponent = (
        <AdobeExperiencePlatformQueryServiceForm
          existing={storedCredentials}
          onParamChange={onParamChange}
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
      {beforeAdvancedSettings}
      <Box mb="3">
        <CollapseTrigger
          open={advancedOpen}
          onOpenChange={setAdvancedOpen}
          caret="start"
          action={
            !advancedOpen && advancedSettingsSummary ? (
              <span className="text-muted">{advancedSettingsSummary}</span>
            ) : undefined
          }
        >
          <span className="link-purple font-weight-bold">
            Advanced Settings
          </span>
        </CollapseTrigger>
        <Collapse open={advancedOpen}>
          <div className="rounded px-3 pt-3 pb-1 mt-2 bg-highlight">
            {advancedSettingsPrefix}
            {datasource.type === "bigquery" && (
              <BigQueryAdvancedSettings
                params={datasource.params || {}}
                onParamChange={onParamChange}
                showProjectId={isCloud() || bigQueryParams?.authType !== "auto"}
              />
            )}
            <SharedConnectionSettings
              type={datasource.type}
              onSettingChange={onSettingChange}
              settings={datasource?.settings || {}}
            />
          </div>
        </Collapse>
      </Box>
    </>
  );
}
