import { FC, ChangeEventHandler } from "react";
import { AthenaConnectionParams } from "shared/types/integrations/athena";
import { isCloud } from "@/services/env";
import Field from "@/components/Forms/Field";

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
              {
                value: "assumeRole",
                display: "Assume IAM Role",
              },
            ]}
            helpText="'Auto-discovery' will look for credentials in environment variables and instance metadata. 'Assume IAM Role' uses the current role to assume another role and execute Athena with temporary credentials."
            value={params.authType || "accessKey"}
            onChange={(e) => {
              setParams({
                authType: e.target.value,
              });
            }}
          />
        </div>
      )}
      {(isCloud() ||
        (params.authType !== "assumeRole" && params.authType !== "auto")) && (
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
      {!isCloud() && params.authType === "assumeRole" && (
        <>
          <div className="form-group col-md-12">
            <label>AWS IAM Role ARN</label>
            <input
              type="text"
              className="form-control"
              name="assumeRoleARN"
              required={!existing}
              value={params.assumeRoleARN || ""}
              onChange={onParamChange}
              placeholder={existing ? "(Keep existing)" : ""}
            />
          </div>
          <div className="form-group col-md-12">
            <label>Role Session Name</label>
            <input
              type="text"
              className="form-control"
              name="roleSessionName"
              required={!existing}
              value={params.roleSessionName || ""}
              onChange={onParamChange}
              placeholder={existing ? "(Keep existing)" : ""}
            />
          </div>
          <div className="form-group col-md-12">
            <label>External ID</label>
            <input
              type="text"
              className="form-control"
              name="externalId"
              required={!existing}
              value={params.externalId || ""}
              onChange={onParamChange}
              placeholder={existing ? "(Keep existing)" : ""}
            />
          </div>
          <div className="form-group col-md-12">
            <label>Session Duration</label>
            <input
              type="number"
              className="form-control"
              name="durationSeconds"
              required={!existing}
              value={params.durationSeconds || 900}
              onChange={onParamChange}
              placeholder={existing ? "(Keep existing)" : ""}
            />
          </div>
        </>
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
      <div className="form-group col-md-12">
        <Field
          name="resultReuseMaxAgeInMinutes"
          type="number"
          label="Reuse query results within past X minutes (optional)"
          helpText="A value of 0 or an empty field will disable reuse of query results"
          value={params.resultReuseMaxAgeInMinutes || ""}
          onChange={onParamChange}
          min={0}
        />
      </div>
    </div>
  );
};

export default AthenaForm;
