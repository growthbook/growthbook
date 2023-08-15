import { FC, ChangeEventHandler } from "react";
import { MixpanelConnectionParams } from "back-end/types/integrations/mixpanel";
import SelectField from "../Forms/SelectField";

const MixpanelForm: FC<{
  params: Partial<MixpanelConnectionParams>;
  existing: boolean;
  onParamChange: ChangeEventHandler<HTMLInputElement | HTMLSelectElement>;
  onManualParamChange: (name: string, value: string) => void;
}> = ({ params, existing, onParamChange, onManualParamChange }) => {
  return (
    <>
      <div className="alert alert-info">
        To connect to Mixpanel, first create a Service Account from your{" "}
        <a
          href="https://mixpanel.com/settings/project#serviceaccounts"
          target="_blank"
          rel="noreferrer noopener"
        >
          Mixpanel Project Settings
        </a>
        .
      </div>
      <div className="row">
        <div className="form-group col-md-12">
          <label>Username</label>
          <input
            type="text"
            className="form-control"
            name="username"
            required
            value={params.username || ""}
            onChange={onParamChange}
          />
        </div>
        <div className="form-group col-md-12">
          <label>Secret</label>
          <input
            type="text"
            className="form-control password-presentation"
            autoComplete="off"
            name="secret"
            required={!existing}
            value={params.secret || ""}
            onChange={onParamChange}
            placeholder={existing ? "(Keep existing)" : ""}
          />
        </div>
        <div className="form-group col-md-12">
          <label>Project Id</label>
          <input
            type="text"
            className="form-control"
            name="projectId"
            required
            value={params.projectId || ""}
            onChange={onParamChange}
          />
        </div>
        <div className="form-group col-md-12">
          <label>API Server</label>
          <SelectField
            name="server"
            value={params.server || "standard"}
            onChange={(v) => {
              onManualParamChange("server", v);
            }}
            options={[
              { value: "standard", label: "Standard (mixpanel.com/api)" },
              { value: "eu", label: "EU Residency (eu.mixpanel.com/api)" },
            ]}
          />
        </div>
      </div>
    </>
  );
};

export default MixpanelForm;
