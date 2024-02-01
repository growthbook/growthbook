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
  const [testConnectionError, setTestConnectionError] = useState<string | null>(
    null
  );
  const [loadingDatasetOptions, setLoadingDatasetOptions] = useState(false);
  const { apiCall } = useAuth();
  async function testConnection() {
    try {
      setLoadingDatasetOptions(true);
      const response = await apiCall<{ datasets: string[] }>(
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

      setDatasetOptions(response.datasets);
    } catch (e) {
      setTestConnectionError(e.message);
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
              <div className="d-flex justify-content-end pt-2">
                <Tooltip
                  body="Must upload a key file in order to test the connection."
                  shouldDisplay={
                    !params.projectId ||
                    !params.clientEmail ||
                    !params.privateKey
                  }
                >
                  <Button
                    disabled={
                      !params.projectId ||
                      !params.clientEmail ||
                      !params.privateKey
                    }
                    color="outline-primary"
                    onClick={async () => {
                      testConnection();
                    }}
                  >
                    {loadingDatasetOptions ? "Loading..." : "Test Connection"}
                  </Button>
                </Tooltip>
              </div>
            </div>
          </div>
          <div className="form-group col-md-12">
            {params && params.projectId ? (
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
        {testConnectionError ? (
          <div className="alert alert-danger">
            <strong>Error:</strong> {testConnectionError}
          </div>
        ) : null}
        {datasetOptions.length && !testConnectionError ? (
          <div className="alert alert-success">
            Connected to <strong>{params.projectId}</strong> successfully!
          </div>
        ) : null}
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
            isClearable={false}
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
