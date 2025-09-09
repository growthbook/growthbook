import { FC, ChangeEventHandler } from "react";
import { ODBCConnectionParams } from "back-end/types/integrations/odbc";
import SelectField from "@/components/Forms/SelectField";
import Callout from "@/components/Radix/Callout";

const ODBCForm: FC<{
  params: Partial<ODBCConnectionParams>;
  onParamChange: ChangeEventHandler<HTMLInputElement>;
  setParams: (params: { [key: string]: string | boolean }) => void;
}> = ({ params, onParamChange, setParams }) => {
  return (
    <>
      <Callout status="info" mb="3">
        <strong>Note:</strong> You must mount the ODBC driver AND configuration
        files (<code>/etc/odbc.ini</code>, <code>/etc/odbcinst.ini</code>)
        within the Docker container before connecting.
      </Callout>
      <div className="row">
        <div className="form-group col-md-12">
          <label>DSN (Data Source Name)</label>
          <input
            type="text"
            className="form-control"
            name="dsn"
            required
            value={params.dsn || ""}
            onChange={onParamChange}
          />
        </div>
      </div>
      <SelectField
        label="Driver"
        value={params.driver || ""}
        onChange={(value: string) => {
          setParams({ ...params, driver: value });
        }}
        options={[{ label: "Impala", value: "impala" }]}
        required
        helpText="The ODBC driver to use. Currently, only Impala is supported."
      />
    </>
  );
};

export default ODBCForm;
