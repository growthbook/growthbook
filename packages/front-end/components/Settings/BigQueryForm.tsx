import { ChangeEventHandler, FC, useState } from "react";
import { BigQueryConnectionParams } from "shared/types/integrations/bigquery";
import { isCloud } from "@/services/env";
import { useAuth } from "@/services/auth";
import Field from "@/components/Forms/Field";
import Tooltip from "@/components/Tooltip/Tooltip";
import SelectField from "@/components/Forms/SelectField";
import Button from "@/components/Button";

const BigQueryForm: FC<{
  params: Partial<BigQueryConnectionParams>;
  existing: boolean;
  setParams: (params: { [key: string]: string }) => void;
  onParamChange: ChangeEventHandler<HTMLInputElement | HTMLSelectElement>;
}> = ({ params, setParams, existing, onParamChange }) => {
  const [testConnectionResults, setTestConnectionResults] = useState<{
    status: "success" | "danger" | "warning";
    message: string;
    datasetOptions: string[];
  } | null>(null);
  const { apiCall } = useAuth();

  async function testConnection() {
    try {
      setTestConnectionResults(null);
      const { datasets } = await apiCall<{ datasets: string[]; error: string }>(
        "/datasources/fetch-bigquery-datasets",
        {
          method: "POST",
          body: JSON.stringify({
            projectId: params.projectId,
            client_email: params.clientEmail,
            private_key: params.privateKey,
          }),
        },
      );
      if (!datasets.length) {
        setTestConnectionResults({
          status: "warning",
          datasetOptions: [],
          message:
            "We were able to connect to BigQuery, but we weren't able to retreive any datasets in this project.",
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
      setTestConnectionResults({
        status: "danger",
        message: e.message,
        datasetOptions: [],
      });
    }
  }

  return (
    <div className="row">
      {!isCloud() && (
        <div className="col-md-12">
          <Field
            label="Authentication Method"
            options={[
              {
                value: "json",
                display: "JSON key file",
              },
              {
                value: "auto",
                display: "Auto-discovery",
              },
            ]}
            helpText="'Auto-discovery' will look for credentials in environment variables and GCP metadata."
            value={params.authType || "json"}
            onChange={(e) => {
              setParams({
                authType: e.target.value,
              });
            }}
          />
        </div>
      )}
      {(isCloud() || params.authType !== "auto") && (
        <>
          <div className="form-group col-md-12">
            <div className="custom-file">
              <input
                type="file"
                required={!existing}
                className="custom-file-input"
                id="bigQueryFileInput"
                accept="application/json"
                onChange={(e) => {
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
                      const json: {
                        project_id: string;
                        private_key: string;
                        client_email: string;
                      } = JSON.parse(str);

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
                Upload key file...
              </label>
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
                  <div
                    className={`alert alert-${testConnectionResults.status}`}
                  >
                    {testConnectionResults.message}
                  </div>
                ) : null}
              </>
            ) : (
              <div className="alert alert-info">
                Your connection info will appear here when you select a valid
                JSON key file.
              </div>
            )}
            <Button
              disabled={
                !params.projectId || !params.clientEmail || !params.privateKey
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
          Default Dataset{" "}
          <Tooltip body="The default dataset is where your experiment assignments are stored. GrowthBook uses this to create default queries that define working assignments and metrics. This value can be edited later if needed." />
        </label>
        {testConnectionResults &&
        testConnectionResults?.datasetOptions.length > 0 ? (
          <SelectField
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
            type="text"
            className="form-control"
            name="defaultDataset"
            value={params.defaultDataset || ""}
            onChange={onParamChange}
            placeholder=""
            helpText={
              params.authType !== "auto"
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
