import { ChangeEventHandler, FC, useEffect, useRef, useState } from "react";
import { stripLeadingUtf8ByteOrderMark } from "shared/util";
import { BigQueryConnectionParams } from "shared/types/integrations/bigquery";
import { isCloud } from "@/services/env";
import { useAuth } from "@/services/auth";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Field from "@/components/Forms/Field";
import Tooltip from "@/components/Tooltip/Tooltip";
import SelectField from "@/components/Forms/SelectField";
import Button from "@/components/Button";
import Callout from "@/ui/Callout";
import TextField from "@/ui/TextField";
import { useCanKeepExistingCredentials } from "@/components/Forms/secretInput";

export function BigQueryAdvancedSettings({
  params,
  onParamChange,
}: {
  params: Partial<BigQueryConnectionParams>;
  onParamChange: ChangeEventHandler<HTMLInputElement>;
}) {
  return (
    <TextField
      mb="3"
      name="apiEndpoint"
      label="API endpoint (optional)"
      placeholder="https://proxy.example.com/"
      value={params.apiEndpoint || ""}
      onChange={onParamChange}
      helpText="Default is https://bigquery.googleapis.com. '/bigquery/v2' is automatically appended to the URL."
    />
  );
}

const BigQueryForm: FC<{
  params: Partial<BigQueryConnectionParams>;
  existing: boolean;
  datasourceId?: string;
  projects?: string[];
  setParams: (params: { [key: string]: string | boolean }) => void;
  onParamChange: ChangeEventHandler<HTMLInputElement | HTMLSelectElement>;
}> = ({
  params,
  setParams,
  existing,
  datasourceId,
  projects,
  onParamChange,
}) => {
  const cloud = isCloud();
  const authType = cloud ? "json" : (params.authType ?? "json");
  const canKeepExistingCredentials = useCanKeepExistingCredentials(
    existing,
    authType,
  );
  const [testConnectionResults, setTestConnectionResults] = useState<{
    status: "success" | "danger" | "warning";
    message: string;
    datasetOptions: string[];
  } | null>(null);
  const { apiCall } = useAuth();
  const permissionsUtil = usePermissionsUtil();
  // Without a saved Data Source, testing requires permission to create one in these projects.
  const canTestConnection =
    !!datasourceId ||
    permissionsUtil.canCreateDataSource({ projects, type: "bigquery" });
  const connectionTest = useRef<AbortController | null>(null);

  useEffect(() => {
    setTestConnectionResults(null);
    return () => connectionTest.current?.abort();
  }, [
    authType,
    params.projectId,
    params.apiEndpoint,
    params.clientEmail,
    params.privateKey,
    datasourceId,
    projects,
  ]);

  async function testConnection() {
    connectionTest.current?.abort();
    const controller = new AbortController();
    connectionTest.current = controller;
    try {
      setTestConnectionResults(null);
      const { datasets } = await apiCall<{
        datasets: string[];
      }>("/datasources/fetch-bigquery-datasets", {
        method: "POST",
        signal: controller.signal,
        body: JSON.stringify({
          projectId: params.projectId,
          apiEndpoint: params.apiEndpoint,
          client_email: params.clientEmail,
          private_key: params.privateKey,
          datasourceId,
          projects,
        }),
      });
      if (controller.signal.aborted) return;
      if (!datasets.length) {
        setTestConnectionResults({
          status: "warning",
          datasetOptions: [],
          message:
            "We were able to connect to BigQuery, but we weren't able to retrieve any datasets in this project.",
        });
        return;
      }
      setTestConnectionResults({
        status: "success",
        datasetOptions: datasets,
        message: `Connected to ${params.projectId} successfully!`,
      });
      const analyticsDataset = datasets.find((d) => d.match(/^analytics_/));
      if (analyticsDataset) {
        setParams({ ["defaultDataset"]: analyticsDataset });
      }
    } catch (e) {
      if (controller.signal.aborted) return;
      setTestConnectionResults({
        status: "danger",
        message: e.message,
        datasetOptions: [],
      });
    }
  }

  return (
    <div className="row">
      {!cloud && (
        <div className="col-md-12">
          <SelectField
            size="legacy"
            label="Authentication Method"
            options={[
              { value: "json", label: "JSON key file" },
              { value: "auto", label: "Auto-discovery" },
            ]}
            helpText="'Auto-discovery' will look for credentials in environment variables and GCP metadata."
            value={authType}
            onChange={(value) => setParams({ authType: value })}
          />
        </div>
      )}
      {(cloud || authType !== "auto") && (
        <>
          <div className="form-group col-md-12">
            <div className="custom-file">
              <input
                type="file"
                required={!canKeepExistingCredentials}
                className="custom-file-input"
                id="bigQueryFileInput"
                accept="application/json"
                onChange={(e) => {
                  connectionTest.current?.abort();
                  setTestConnectionResults(null);
                  const file: File | undefined = e.target?.files?.[0];
                  if (!file) {
                    return;
                  }

                  const reader = new FileReader();
                  reader.onload = function (e) {
                    try {
                      const str = e.target?.result;
                      if (typeof str !== "string") {
                        return;
                      }
                      const raw = stripLeadingUtf8ByteOrderMark(str);
                      const json: {
                        project_id: string;
                        private_key: string;
                        client_email: string;
                      } = JSON.parse(raw);

                      if (
                        json.project_id &&
                        json.private_key &&
                        json.client_email
                      ) {
                        setParams({
                          privateKey: json.private_key,
                          projectId: json.project_id,
                          clientEmail: json.client_email,
                          defaultProject: json.project_id,
                          serviceAccountJson: raw,
                        });
                      }
                    } catch (e) {
                      console.error(e);
                      return;
                    }
                  };
                  reader.readAsText(file);
                }}
              />
              <label className="custom-file-label" htmlFor="bigQueryFileInput">
                {canKeepExistingCredentials
                  ? "Upload a new key file..."
                  : "Upload key file..."}
              </label>
              {canKeepExistingCredentials ? (
                <small>Leave blank to keep the existing credentials.</small>
              ) : null}
            </div>
          </div>
          <div className="form-group col-md-12">
            {params && params.projectId ? (
              <>
                <ul>
                  <li>
                    <strong>BigQuery Project Id:</strong> {params.projectId}
                  </li>
                  <li>
                    <strong>Client Email:</strong> {params.clientEmail}
                  </li>
                  <li>
                    <strong>Private Key:</strong> *****
                  </li>
                </ul>
                {testConnectionResults?.message ? (
                  <Callout
                    status={
                      testConnectionResults.status === "danger"
                        ? "error"
                        : testConnectionResults.status
                    }
                  >
                    {testConnectionResults.message}
                  </Callout>
                ) : null}
              </>
            ) : (
              <Callout status="info">
                Your connection info will appear here when you select a valid
                JSON key file.
              </Callout>
            )}
            <Button
              disabled={
                !canTestConnection ||
                !params.projectId ||
                !params.clientEmail ||
                (!params.privateKey && !datasourceId)
              }
              color="primary"
              className="mt-2"
              onClick={async () => {
                await testConnection();
              }}
            >
              Test Connection
            </Button>
          </div>
        </>
      )}
      <div className="form-group col-md-12">
        <label>BigQuery Project ID</label>
        <Field
          size="legacy"
          type="text"
          className="form-control"
          name="defaultProject"
          value={params.defaultProject || ""}
          onChange={onParamChange}
          placeholder=""
        />
      </div>
      <div className="form-group col-md-12">
        <label>
          Reservation (optional){" "}
          <Tooltip body="If set, GrowthBook will include this reservation on all BigQuery query jobs. Use the full reservation resource name (e.g. projects/my-project/locations/US/reservations/my-reservation)." />
        </label>
        <Field
          size="legacy"
          type="text"
          className="form-control"
          name="reservation"
          value={params.reservation || ""}
          onChange={onParamChange}
        />
      </div>
      <div className="form-group col-md-12">
        <label>
          Default Dataset{" "}
          <Tooltip body="The default dataset is where your experiment assignments are stored. GrowthBook uses this to create default queries that define working assignments and metrics. This value can be edited later if needed." />
        </label>
        {testConnectionResults &&
        testConnectionResults?.datasetOptions.length > 0 ? (
          <SelectField
            size="legacy"
            placeholder="Choose a dataset or create a new one..."
            name="defaultDataset"
            autoComplete="off"
            sort={false}
            options={testConnectionResults.datasetOptions.map((option) => ({
              label: option,
              value: option,
            }))}
            createable
            required
            isClearable
            value={params.defaultDataset || ""}
            onChange={(value) => setParams({ ["defaultDataset"]: value })}
            helpText="Select the dataset where your experiment assignments are or will be stored."
          />
        ) : (
          <Field
            size="legacy"
            type="text"
            className="form-control"
            name="defaultDataset"
            value={params.defaultDataset || ""}
            onChange={onParamChange}
            placeholder=""
            helpText={
              authType !== "auto"
                ? "Use the 'Test Connection' button to fetch a list of datasets from your BigQuery project."
                : ""
            }
            required
          />
        )}
      </div>
    </div>
  );
};

export default BigQueryForm;
