import { FC, ChangeEventHandler } from "react";
import { AdobeExperiencePlatformQueryServiceConnectionParams } from "shared/types/integrations/adobe-experience-platform-query-service";
import TextField from "@/ui/TextField";
import {
  KEEP_EXISTING_PLACEHOLDER,
  useCanKeepExistingCredentials,
} from "@/components/Forms/secretInput";

const AdobeExperiencePlatformQueryServiceForm: FC<{
  params: Partial<AdobeExperiencePlatformQueryServiceConnectionParams>;
  existing: boolean;
  onParamChange: ChangeEventHandler<HTMLInputElement>;
}> = ({ params, existing, onParamChange }) => {
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
          value={params.port ?? 80}
          onChange={onParamChange}
        />
      </div>
      <div className="form-group col-md-12">
        <TextField
          label="Database"
          name="database"
          required
          value={params.database || ""}
          onChange={onParamChange}
        />
      </div>
      <div className="form-group col-md-12">
        <TextField
          label="Username"
          name="username"
          required
          value={params.username || ""}
          onChange={onParamChange}
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

export default AdobeExperiencePlatformQueryServiceForm;
