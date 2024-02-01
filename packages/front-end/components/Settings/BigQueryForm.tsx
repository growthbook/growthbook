import { ChangeEventHandler, FC, useState } from "react";
import { BigQueryConnectionParams } from "back-end/types/integrations/bigquery";
import { isCloud } from "@/services/env";
import { useAuth } from "@/services/auth";
import Field from "../Forms/Field";
import Tooltip from "../Tooltip/Tooltip";
import SelectField from "../Forms/SelectField";
import Button from "../Button";

const BigQueryForm: FC<{
  params: Partial<BigQueryConnectionParams>;
  existing: boolean;
  setParams: (params: { [key: string]: string }) => void;
  onParamChange: ChangeEventHandler<HTMLInputElement | HTMLSelectElement>;
}> = ({ params, setParams, existing, onParamChange }) => {
  const [datasetOptions, setDatasetOptions] = useState<string[]>([]);
  const [testConnectionResults, setTestConnectionResults] = useState<{
    status: "success" | "danger" | "warning";
    message: string;
  } | null>(null);
  const [loadingDatasetOptions, setLoadingDatasetOptions] = useState(false);
  const { apiCall } = useAuth();

  async function testConnection() {
    try {
      setLoadingDatasetOptions(true);
      const { datasets } = await apiCall<{ datasets: string[]; error: string }>(
        "/datasources/test-connection",
        {
          method: "POST",
          body: JSON.stringify({
            projectId: params.projectId,
            client_email: params.clientEmail,
            private_key: params.privateKey,
          }),
        }
      );

      setDatasetOptions(datasets);

      if (!datasets.length) {
        setTestConnectionResults({
          status: "warning",
          message:
            "We were able to connect to BigQuery, but we weren't able to retreive any datasets in this project.",
        });
        return;
      }
      setTestConnectionResults({
        status: "success",
        message: `Connected to ${params.projectId} successfully!`,
      });
      //TODO: Intelligently select a default dataset based on the datasource type (manual, ga4, segment, etc)
    } catch (e) {
      setTestConnectionResults({ status: "danger", message: e.message });
    }
    setLoadingDatasetOptions(false);
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
                  // @ts-expect-error TS(2531) If you come across this, please fix it!: Object is possibly 'null'.
                  const file = e.target.files[0];
                  if (!file) {
                    return;
                  }

                  const reader = new FileReader();
                  reader.onload = function (e) {
                    try {
                      // @ts-expect-error TS(2531) If you come across this, please fix it!: Object is possibly 'null'.
                      const str = e.target.result;
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
                {!testConnectionResults ? (
                  <Button
                    color="primary"
                    onClick={async () => {
                      testConnection();
                    }}
                  >
                    {loadingDatasetOptions ? "Loading..." : "Test Connection"}
                  </Button>
                ) : (
                  <div
                    className={`alert alert-${testConnectionResults.status}`}
                  >
                    {testConnectionResults.message}
                  </div>
                )}
              </>
            ) : (
              <div className="alert alert-info">
                Your connection info will appear here when you select a valid
                JSON key file.
              </div>
            )}
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
        {datasetOptions.length > 0 ? (
          <SelectField
            placeholder="Choose a dataset or create a new one..."
            name="defaultDataset"
            autoComplete="off"
            sort={false}
            options={datasetOptions.map((option) => ({
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
            helpText="Use the 'Test Connection' button to fetch a list of datasets from your BigQuery project."
            required
          />
        )}
      </div>
    </div>
  );
};

export default BigQueryForm;
