import { FC, ChangeEventHandler } from "react";
import { BigQueryConnectionParams } from "back-end/types/integrations/bigquery";
import { isCloud } from "@/services/env";
import Tooltip from "@/components/Tooltip/Tooltip";
import Field from "../Forms/Field";

const BigQueryForm: FC<{
  params: Partial<BigQueryConnectionParams>;
  existing: boolean;
  setParams: (params: { [key: string]: string }) => void;
  onParamChange: ChangeEventHandler<HTMLInputElement | HTMLSelectElement>;
}> = ({ params, setParams, existing, onParamChange }) => {
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
        <label>
          BigQuery Project ID{" "}
          <Tooltip body="The default project ID GrowthBook will use when creating queries and discovering metrics. You can find this value from your BigQuery project info card on your BigQuery Dashboard, or the name of the top level SQL item in the BigQuery console SQL workspace. This value can be edited later if needed." />
        </label>
        <Field
          type="text"
          className="form-control"
          name="defaultProject"
          value={params.defaultProject || ""}
          onChange={onParamChange}
          placeholder=""
          helpText="The default project ID GrowthBook will use when connecting to your data."
        />
      </div>
      <div className="form-group col-md-12">
        <label>
          Dataset{" "}
          <Tooltip body="Specifying a dataset here allows GrowthBook to create working assignment and metric queries, and enables the automatic discovery metrics. You can find this from your BigQuery console SQL workspace. This value can be edited later if needed." />
        </label>
        <Field
          type="text"
          className="form-control"
          name="defaultDataset"
          value={params.defaultDataset || ""}
          onChange={onParamChange}
          placeholder=""
          helpText="The default dataset GrowthBook will use when building queries and discovering metrics for this data source."
        />
      </div>
    </div>
  );
};

export default BigQueryForm;
