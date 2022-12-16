import { FC, ChangeEventHandler } from "react";
import { BigQueryConnectionParams } from "back-end/types/integrations/bigquery";
import { isCloud } from "@/services/env";
import Field from "../Forms/Field";

const BigQueryForm: FC<{
  params: Partial<BigQueryConnectionParams>;
  setParams: (params: { [key: string]: string }) => void;
  onParamChange: ChangeEventHandler<HTMLInputElement | HTMLSelectElement>;
}> = ({ params, setParams, onParamChange }) => {
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
                className="custom-file-input"
                id="bigQueryFileInput"
                accept="application/json"
                onChange={(e) => {
                  const file = e.target.files[0];
                  if (!file) {
                    return;
                  }

                  const reader = new FileReader();
                  reader.onload = function (e) {
                    try {
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
                  <strong>Project Id:</strong> {params.projectId}
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
        <label>Default Project Name</label>
        <input
          type="text"
          className="form-control"
          name="defaultProject"
          value={params.defaultProject || ""}
          onChange={onParamChange}
          placeholder="(optional)"
        />
      </div>
      <div className="form-group col-md-12">
        <label>Default Dataset</label>
        <input
          type="text"
          className="form-control"
          name="defaultDataset"
          value={params.defaultDataset || ""}
          onChange={onParamChange}
          placeholder="(optional)"
        />
      </div>
    </div>
  );
};

export default BigQueryForm;
