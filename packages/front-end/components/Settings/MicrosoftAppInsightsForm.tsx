import { FC, ChangeEventHandler } from "react";
import { MicrosoftAppInsightsParams } from "back-end/types/integrations/microsoftappinsights";

const MicrosoftAppInsightsForm: FC<{
  params: Partial<MicrosoftAppInsightsParams>;
  existing: boolean;
  error: boolean;
  onParamChange: ChangeEventHandler<HTMLInputElement>;
  setParams: (params: { [key: string]: string }) => void;
}> = ({ params, onParamChange }) => {
  return (
    <div>
      <div className="row">
        <div className="form-group col-md-12">
          <label>Application Id</label>
          <input
            type="text"
            className="form-control"
            name="appId"
            required
            value={params.appId || ""}
            onChange={onParamChange}
          />
        </div>
        <div className="form-group col-md-12">
          <label>API Key</label>
          <input
            type="password"
            className="form-control"
            name="apiKey"
            required
            value={params.apiKey || ""}
            onChange={onParamChange}
          />
        </div>
      </div>
    </div>
  );
};

export default MicrosoftAppInsightsForm;
