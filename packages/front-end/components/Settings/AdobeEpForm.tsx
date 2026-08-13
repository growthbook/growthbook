import { FC, ChangeEventHandler } from "react";
import { AdobeEpConnectionParams } from "shared/types/integrations/adobe-ep";
import TextField from "@/ui/TextField";
import Switch from "@/ui/Switch";
import {
  KEEP_EXISTING_PLACEHOLDER,
  useCanKeepExistingCredentials,
} from "@/components/Forms/secretInput";

const AdobeEpForm: FC<{
  params: Partial<AdobeEpConnectionParams>;
  existing: boolean;
  onParamChange: ChangeEventHandler<HTMLInputElement>;
  setParams: (params: { [key: string]: string | boolean }) => void;
}> = ({ params, existing, onParamChange, setParams }) => {
  const canKeepExistingCredentials = useCanKeepExistingCredentials(
    existing,
    "credential",
  );

  return (
    <div className="row">
      <div className="form-group col-md-12">
        <TextField
          label="Host"
          name="host"
          required
          placeholder="acme.platform.adobe.io"
          value={params.host || ""}
          onChange={onParamChange}
        />
      </div>
      <div className="form-group col-md-12">
        <TextField
          label="Port"
          type="number"
          name="port"
          required
          value={params.port || 5432}
          onChange={onParamChange}
        />
      </div>
      <div className="form-group col-md-12">
        <TextField
          label="Organization ID"
          name="orgId"
          required
          helpText="From the Adobe Admin Console. GrowthBook appends @AdobeOrg."
          value={params.orgId || ""}
          onChange={onParamChange}
        />
      </div>
      <div className="form-group col-md-12">
        <TextField
          label="Sandbox"
          name="sandbox"
          required
          value={params.sandbox || ""}
          onChange={onParamChange}
        />
      </div>
      <div className="form-group col-md-12">
        <TextField
          label="Container"
          name="container"
          required
          helpText="Use all, a dataset id, a view id, or a database name."
          value={params.container || ""}
          onChange={onParamChange}
        />
      </div>
      <div className="form-group col-md-12">
        <Switch
          label="Flatten"
          description="Flatten XDM structs to dot notation."
          value={params.flatten ?? false}
          onChange={(checked) => setParams({ flatten: checked })}
        />
      </div>
      <div className="form-group col-md-12">
        <TextField
          label="Technical account ID"
          name="technicalAccountId"
          required
          value={params.technicalAccountId || ""}
          onChange={onParamChange}
        />
      </div>
      <div className="form-group col-md-12">
        <TextField
          label="Credential"
          type="password"
          autoComplete="off"
          name="credential"
          required={!canKeepExistingCredentials}
          value={params.credential || ""}
          onChange={onParamChange}
          placeholder={
            canKeepExistingCredentials ? KEEP_EXISTING_PLACEHOLDER : ""
          }
        />
      </div>
    </div>
  );
};

export default AdobeEpForm;
