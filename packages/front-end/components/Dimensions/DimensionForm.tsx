import { FC, useMemo, useState } from "react";
import Modal from "../Modal";
import { useForm } from "react-hook-form";
import { useAuth } from "../../services/auth";
import { DimensionInterface } from "back-end/types/dimension";
import { useDefinitions } from "../../services/DefinitionsContext";
import Field from "../Forms/Field";
import SelectField from "../Forms/SelectField";
import CodeTextArea from "../Forms/CodeTextArea";
import useMembers from "../../hooks/useMembers";
import { validateSQL } from "../../services/datasources";
import { TestQueryRow } from "back-end/src/types/Integration";
import { FaPlay } from "react-icons/fa";
import DisplayTestQueryResults from "../Settings/DisplayTestQueryResults";

type TestQueryResults = {
  duration?: string;
  error?: string;
  results?: TestQueryRow[];
  sql?: string;
};

const DimensionForm: FC<{
  close: () => void;
  current: Partial<DimensionInterface>;
}> = ({ close, current }) => {
  const [
    testQueryResults,
    setTestQueryResults,
  ] = useState<TestQueryResults | null>(null);
  const { apiCall } = useAuth();
  const { memberUsernameOptions } = useMembers();
  const {
    getDatasourceById,
    datasources,
    mutateDefinitions,
  } = useDefinitions();
  const form = useForm({
    defaultValues: {
      name: current.name || "",
      sql: current.sql || "",
      datasource: (current.id ? current.datasource : datasources[0]?.id) || "",
      userIdType: current.userIdType || "user_id",
      owner: current.owner || "",
    },
  });

  const datasource = form.watch("datasource");
  const userIdType = form.watch("userIdType");
  const userEnteredQuery = form.watch("sql");

  const dsObj = getDatasourceById(datasource);
  const dsProps = dsObj?.properties;
  const sql = dsProps?.queryLanguage === "sql";

  const requiredColumns = useMemo(() => {
    return new Set(["user_id", "value"]);
  }, []);

  const handleTestQuery = async () => {
    setTestQueryResults(null);
    try {
      validateSQL(userEnteredQuery, [...requiredColumns]);

      const res: TestQueryResults = await apiCall("/query/test", {
        method: "POST",
        body: JSON.stringify({
          query: userEnteredQuery,
          datasourceId: dsObj.id,
        }),
      });

      setTestQueryResults(res);
    } catch (e) {
      setTestQueryResults({ error: e.message });
    }
  };

  return (
    <Modal
      close={close}
      open={true}
      header={current ? "Edit Dimension" : "New Dimension"}
      submit={form.handleSubmit(async (value) => {
        if (sql) {
          validateSQL(value.sql, [value.userIdType, "value"]);
        }

        await apiCall(
          current.id ? `/dimensions/${current.id}` : `/dimensions`,
          {
            method: current.id ? "PUT" : "POST",
            body: JSON.stringify(value),
          }
        );
        mutateDefinitions();
      })}
    >
      <Field label="Name" required {...form.register("name")} />
      <Field
        label="Owner"
        options={memberUsernameOptions}
        comboBox
        {...form.register("owner")}
      />
      <SelectField
        label="Data Source"
        required
        value={form.watch("datasource")}
        onChange={(v) => form.setValue("datasource", v)}
        placeholder="Choose one..."
        options={datasources.map((d) => ({
          value: d.id,
          label: d.name,
        }))}
      />
      {dsProps.userIds && (
        <SelectField
          label="Identifier Type"
          required
          value={userIdType}
          onChange={(v) => form.setValue("userIdType", v)}
          options={(dsObj.settings.userIdTypes || []).map((t) => {
            return {
              label: t.userIdType,
              value: t.userIdType,
            };
          })}
        />
      )}
      {sql ? (
        <div className="row">
          <div className="col-lg-12">
            <label className="font-weight-bold mb-1">SQL Query</label>
            <div>
              <div className="d-flex justify-content-between align-items-center p-1 border rounded">
                <button
                  className="btn btn-sm btn-primary m-1"
                  onClick={(e) => {
                    e.preventDefault();
                    handleTestQuery();
                  }}
                >
                  <span className="pr-2">
                    <FaPlay />
                  </span>
                  Test Query
                </button>
              </div>
              <CodeTextArea
                required
                language="sql"
                value={userEnteredQuery}
                setValue={(sql) => form.setValue("sql", sql)}
                placeholder={`SELECT\n      ${userIdType}, browser as value\nFROM\n      users`}
                helpText={
                  <>
                    Select two columns named <code>{userIdType}</code> and{" "}
                    <code>value</code>
                  </>
                }
              />
              {testQueryResults && (
                <DisplayTestQueryResults
                  duration={parseInt(testQueryResults.duration || "0")}
                  requiredColumns={[...requiredColumns]}
                  result={testQueryResults.results?.[0]}
                  error={testQueryResults.error}
                  sql={testQueryResults.sql}
                />
              )}
            </div>
          </div>
        </div>
      ) : (
        <Field
          label="Event Condition"
          required
          {...form.register("sql")}
          textarea
          minRows={3}
          placeholder={"$browser"}
        />
      )}
      <p>
        <strong>Important:</strong> Please limit dimensions to at most 50 unique
        values.
      </p>
    </Modal>
  );
};
export default DimensionForm;
