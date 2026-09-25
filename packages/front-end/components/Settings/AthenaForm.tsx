import { FC, ChangeEventHandler } from "react";
import { AthenaConnectionParams } from "shared/types/integrations/athena";
import { isCloud } from "@/services/env";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import {
  KEEP_EXISTING_PLACEHOLDER,
  useCanKeepExistingCredentials,
} from "@/components/Forms/secretInput";

const AthenaForm: FC<{
  params: Partial<AthenaConnectionParams>;
  existing: boolean;
  setParams: (params: { [key: string]: string }) => void;
  onParamChange: ChangeEventHandler<HTMLInputElement>;
}> = ({ params, setParams, existing, onParamChange }) => {
  const cloud = isCloud();
  const authType = cloud ? "accessKey" : (params.authType ?? "accessKey");
  const canKeepExistingCredentials = useCanKeepExistingCredentials(
    existing,
    authType,
  );

  return (
    <div className="row">
      {!cloud && (
        <div className="col-md-12">
          <SelectField
            size="legacy"
            label="Authentication Method"
            options={[
              { value: "accessKey", label: "AWS access key" },
              { value: "auto", label: "Auto-discovery" },
              { value: "assumeRole", label: "Assume IAM Role" },
            ]}
            helpText="'Auto-discovery' will look for credentials in environment variables and instance metadata. 'Assume IAM Role' uses the current role to assume another role and execute Athena with temporary credentials."
            value={authType}
            onChange={(value) => setParams({ authType: value })}
          />
        </div>
      )}
      {(cloud || (authType !== "assumeRole" && authType !== "auto")) && (
        <>
          <div className="form-group col-md-12">
            <label>AWS Access Key</label>
            <input
              type="text"
              className="form-control"
              name="accessKeyId"
              required={!canKeepExistingCredentials}
              value={params.accessKeyId || ""}
              onChange={onParamChange}
              placeholder={
                canKeepExistingCredentials ? KEEP_EXISTING_PLACEHOLDER : ""
              }
            />
          </div>
          <div className="form-group col-md-12">
            <label>Access Secret</label>
            <input
              type="text"
              className="form-control password-presentation"
              autoComplete="off"
              name="secretAccessKey"
              required={!canKeepExistingCredentials}
              value={params.secretAccessKey || ""}
              onChange={onParamChange}
              placeholder={
                canKeepExistingCredentials ? KEEP_EXISTING_PLACEHOLDER : ""
              }
            />
          </div>
        </>
      )}
      {!cloud && authType === "assumeRole" && (
        <>
          <div className="form-group col-md-12">
            <label>AWS IAM Role ARN</label>
            <input
              type="text"
              className="form-control"
              name="assumeRoleARN"
              required={!canKeepExistingCredentials}
              value={params.assumeRoleARN || ""}
              onChange={onParamChange}
            />
          </div>
          <div className="form-group col-md-12">
            <label>Role Session Name</label>
            <input
              type="text"
              className="form-control"
              name="roleSessionName"
              required={!canKeepExistingCredentials}
              value={params.roleSessionName || ""}
              onChange={onParamChange}
            />
          </div>
          <div className="form-group col-md-12">
            <label>External ID</label>
            <input
              type="text"
              className="form-control"
              name="externalId"
              required={!canKeepExistingCredentials}
              value={params.externalId || ""}
              onChange={onParamChange}
            />
          </div>
          <div className="form-group col-md-12">
            <label>Session Duration</label>
            <input
              type="number"
              className="form-control"
              name="durationSeconds"
              required={!canKeepExistingCredentials}
              value={params.durationSeconds || 900}
              onChange={onParamChange}
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
          size="legacy"
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
