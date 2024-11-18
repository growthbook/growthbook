import { FC, ChangeEventHandler, useState } from "react";
import { SnowflakeConnectionParams } from "back-end/types/integrations/snowflake";
import Tooltip from "@/components/Tooltip/Tooltip";
import Toggle from "@/components/Forms/Toggle";

const SnowflakeForm: FC<{
  params: Partial<SnowflakeConnectionParams>;
  existing: boolean;
  onParamChange: ChangeEventHandler<HTMLInputElement>;
  onManualParamChange: (name: string, value: string) => void;
}> = ({ params, existing, onParamChange, onManualParamChange }) => {
  const [useAccessUrl, setUseAccessUrl] = useState(!!params.accessUrl);
  return (
    <div className="row">
      <div className="form-group col-md-12">
        <label>账号</label>
        <input
          type="text"
          className="form-control"
          name="account"
          required
          placeholder="xy12345.us-east-2.aws"
          value={params.account || ""}
          onChange={onParamChange}
        />
      </div>
      <div className="form-group col-md-12">
        <label>用户名</label>
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
        <label>密码</label>
        <input
          type="text"
          className="form-control password-presentation"
          autoComplete="off"
          name="password"
          required={!existing}
          value={params.password || ""}
          onChange={onParamChange}
          placeholder={existing ? "(保持现有)" : ""}
        />
      </div>
      <div className="form-group col-md-12">
        <label>数据库</label>
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
        <label>Schema</label>
        <input
          type="text"
          className="form-control"
          name="schema"
          required
          value={params.schema || ""}
          onChange={onParamChange}
        />
      </div>
      <div className="form-group col-md-12">
        <label>角色</label>
        <input
          type="text"
          className="form-control"
          name="role"
          value={params.role || ""}
          onChange={onParamChange}
        />
      </div>
      <div className="form-group col-md-12">
        <label>
          仓库（可选）{" "}
          <Tooltip body="如果未指定仓库，查询将在Snowflake中为您的用户设置的默认仓库中执行。" />
        </label>
        <input
          type="text"
          className="form-control"
          name="warehouse"
          value={params.warehouse || ""}
          onChange={onParamChange}
          placeholder=""
        />
      </div>
      <div className="col-md-12">
        <div className="form-group">
          <label htmlFor="access-url" className="mr-2">
            使用访问URL（可选）
          </label>
          <Toggle
            id="access-url"
            label="使用访问URL（可选）"
            value={useAccessUrl}
            setValue={(v) => {
              setUseAccessUrl(v);
              if (!v) {
                onManualParamChange("accessUrl", "");
              }
            }}
          />
        </div>
      </div>
      {useAccessUrl ? (
        <div className="form-group col-md-12">
          <label>
            Access URL{" "}
            <Tooltip body="覆盖账号，使GrowthBook指向特定URL" />
          </label>
          <input
            type="text"
            className="form-control"
            name="accessUrl"
            required
            value={params.accessUrl || ""}
            onChange={onParamChange}
          />
        </div>
      ) : null}
    </div>
  );
};

export default SnowflakeForm;
