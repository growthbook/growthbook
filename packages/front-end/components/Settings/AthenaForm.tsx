import { FC, ChangeEventHandler } from "react";
import { AthenaConnectionParams } from "back-end/types/integrations/athena";
import { isCloud } from "@/services/env";
import Field from "../Forms/Field";

const AthenaForm: FC<{
  params: Partial<AthenaConnectionParams>;
  existing: boolean;
  setParams: (params: { [key: string]: string }) => void;
  onParamChange: ChangeEventHandler<HTMLInputElement>;
}> = ({ params, setParams, existing, onParamChange }) => {
  return (
    <div className="row">
      {!isCloud() && (
        <div className="col-md-12">
          <Field
            label="Authentication Method"
            options={[
              {
                value: "accessKey",
                display: "AWS access key",
              },
              {
                value: "auto",
                display: "Auto-discovery",
              },
            ]}
            helpText="'Auto-discovery' will look for credentials in environment variables and instance metadata."
            value={params.authType || "accessKey"}
            onChange={(e) => {
              setParams({
                authType: e.target.value,
              });
            }}
          />
        </div>
      )}
      <div className="form-group col-md-12">
        <label>AWS Region</label>
        <input
          type="text"
          className="form-control"
          name="region"
          required
          value={params.region || ""}
          onChange={onParamChange}
        />
      </div>
      <div className="form-group col-md-12">
        <label>Workgroup (optional)</label>
        <input
          type="text"
          className="form-control"
          name="workGroup"
          placeholder="primary"
          value={params.workGroup || ""}
          onChange={onParamChange}
        />
      </div>
      {(isCloud() || params.authType !== "auto") && (
        <>
          <div className="form-group col-md-12">
            <label>AWS Access Key</label>
            <input
              type="text"
              className="form-control"
              name="accessKeyId"
              required={!existing}
              value={params.accessKeyId || ""}
              onChange={onParamChange}
              placeholder={existing ? "(Keep existing)" : ""}
            />
          </div>
          <div className="form-group col-md-12">
            <label>Access Secret</label>
            <input
              type="text"
              className="form-control password-presentation"
              autoComplete="off"
              name="secretAccessKey"
              required={!existing}
              value={params.secretAccessKey || ""}
              onChange={onParamChange}
              placeholder={existing ? "(Keep existing)" : ""}
            />
          </div>
        </>
      )}
      <div className="form-group col-md-12">
        <label>Default Catalog (optional)</label>
        <input
          type="text"
          className="form-control"
          name="catalog"
          value={params.catalog || ""}
          onChange={onParamChange}
        />
      </div>
      <div className="form-group col-md-12">
        <label>Default Database (optional)</label>
        <input
          type="text"
          className="form-control"
          name="database"
          value={params.database || ""}
          onChange={onParamChange}
        />
      </div>
      <div className="form-group col-md-12">
        <label>S3 Results URL</label>
        <input
          type="text"
          className="form-control"
          name="bucketUri"
          required
          value={params.bucketUri || ""}
          onChange={onParamChange}
        />
      </div>
    </div>
  );
};

export default AthenaForm;
