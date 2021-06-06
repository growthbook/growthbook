import { FC, ChangeEventHandler } from "react";
import { MixpanelConnectionParams } from "back-end/types/integrations/mixpanel";

const MixpanelForm: FC<{
  params: Partial<MixpanelConnectionParams>;
  existing: boolean;
  onParamChange: ChangeEventHandler<HTMLInputElement>;
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
          Project Settings
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
            type="password"
            className="form-control"
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
      </div>
    </>
  );
};

export default MixpanelForm;
