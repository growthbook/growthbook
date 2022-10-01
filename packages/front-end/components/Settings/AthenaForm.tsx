import { FC, ChangeEventHandler } from "react";
import { AthenaConnectionParams } from "back-end/types/integrations/athena";

const AthenaForm: FC<{
  params: Partial<AthenaConnectionParams>;
  existing: boolean;
  onParamChange: ChangeEventHandler<HTMLInputElement>;
}> = ({ params, existing, onParamChange }) => {
  return (
    <div className="row">
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
          required
          value={params.workGroup || ""}
          onChange={onParamChange}
        />
      </div>
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
      <div className="form-group col-md-12">
        <label>Database Name</label>
        <input
          type="text"
          className="form-control"
          name="database"
          required
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
