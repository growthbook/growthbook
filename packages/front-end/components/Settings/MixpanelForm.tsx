import { FC, ChangeEventHandler } from "react";
import { MixpanelConnectionParams } from "back-end/types/integrations/mixpanel";

const MixpanelForm: FC<{
  params: Partial<MixpanelConnectionParams>;
  existing: boolean;
  onParamChange: ChangeEventHandler<HTMLInputElement | HTMLSelectElement>;
}> = ({ params, existing, onParamChange }) => {
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
          <select
            className="form-control"
            name="server"
            value={params.server || "standard"}
            onChange={onParamChange}
          >
            <option value="standard">Standard (mixpanel.com/api)</option>
            <option value="eu">EU Residency (eu.mixpanel.com/api)</option>
          </select>
        </div>
      </div>
    </>
  );
};

export default MixpanelForm;
