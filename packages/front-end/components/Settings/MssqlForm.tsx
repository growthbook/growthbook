import { FC, ChangeEventHandler } from "react";
import { MssqlConnectionParams } from "back-end/types/integrations/mssql";
import Toggle from "@/components/Forms/Toggle";
import Tooltip from "@/components/Tooltip/Tooltip";
import HostWarning from "./HostWarning";

const MssqlForm: FC<{
  params: Partial<MssqlConnectionParams>;
  existing: boolean;
  onParamChange: ChangeEventHandler<HTMLInputElement>;
  setParams: (params: {
    [key: string]: string | boolean | number | Record<string, unknown>;
  }) => void;
}> = ({ params, existing, onParamChange, setParams }) => {
  return (
    <>
      <HostWarning
        host={params.server ?? ""}
        setHost={(host) => {
          setParams({
            server: host,
          });
        }}
      />
      <div className="row">
        <div className="form-group col-md-12">
          <label>服务器</label>
          <input
            type="text"
            className="form-control"
            name="server"
            required
            value={params.server || ""}
            onChange={onParamChange}
          />
        </div>
        <div className="form-group col-md-12">
          <label>端口（Port）</label>
          <input
            type="number"
            className="form-control"
            name="port"
            required
            value={params.port || ""}
            onChange={onParamChange}
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
          <label>用户</label>
          <input
            type="text"
            className="form-control"
            name="user"
            required
            value={params.user || ""}
            onChange={onParamChange}
          />
        </div>
        <div className="form-group col-md-12">
          <label>密码</label>
          <input
            type="text"
            className="form-control password-presentation"
            name="password"
            required={!existing}
            value={params.password || ""}
            onChange={onParamChange}
            placeholder={existing ? "(Keep existing)" : ""}
          />
        </div>
        <div className="form-group col-md-12">
          <label>请求超时时间</label>
          <input
            type="number"
            className="form-control"
            name="requestTimeout"
            value={params.requestTimeout || ""}
            onChange={onParamChange}
            placeholder="(可选 - 以秒为单位。如果为空，将禁用此功能)"
          />
          <div className="form-text text-muted small">
            请求被视为失败之前的秒数。连接默认超时时间为15秒。设置为0可禁用超时。
          </div>
        </div>
        <div className="form-group col-md-12">
          <label>默认Schema</label>
          <input
            type="text"
            className="form-control"
            name="defaultSchema"
            value={params.defaultSchema || ""}
            onChange={onParamChange}
            placeholder="(可选)"
          />
        </div>
      </div>
      <div className="row mt-2">
        <div className="col-md-12">
          <div className="form-group">
            <label htmlFor="trust-server-cert" className="mr-2">
              信任服务器证书{" "}
              <Tooltip body="允许使用自签名证书"></Tooltip>
            </label>
            <Toggle
              id="trust-server-cert"
              label="信任服务器证书"
              value={params.options?.trustServerCertificate === true}
              setValue={(value) => {
                const opt = {
                  ...params.options,
                  trustServerCertificate: value,
                };
                setParams({
                  options: opt,
                });
              }}
            />
          </div>
          <div className="form-group">
            <label htmlFor="encryption" className="mr-2">
              启用加密
            </label>
            <Toggle
              id="encryption"
              label="启用加密"
              value={params.options?.encrypt === true}
              setValue={(value) => {
                const opt = { ...params.options, encrypt: value };
                setParams({
                  options: opt,
                });
              }}
            />
          </div>
        </div>
      </div>
    </>
  );
};

export default MssqlForm;
