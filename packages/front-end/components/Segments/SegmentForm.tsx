import { FC, useMemo, useState } from "react";
import Modal from "../Modal";
import { SegmentInterface } from "back-end/types/segment";
import { useForm } from "react-hook-form";
import { useAuth } from "../../services/auth";
import { useDefinitions } from "../../services/DefinitionsContext";
import Field from "../Forms/Field";
import SelectField from "../Forms/SelectField";
import CodeTextArea from "../../components/Forms/CodeTextArea";
import useMembers from "../../hooks/useMembers";
import { validateSQL } from "../../services/datasources";
import { FaPlay } from "react-icons/fa";
import { TestQueryRow } from "back-end/src/types/Integration";
import DisplayTestQueryResults from "../Settings/DisplayTestQueryResults";

type TestQueryResults = {
  duration?: string;
  error?: string;
  results?: TestQueryRow[];
  sql?: string;
};

const SegmentForm: FC<{
  close: () => void;
  current: Partial<SegmentInterface>;
}> = ({ close, current }) => {
  const [
    testQueryResults,
    setTestQueryResults,
  ] = useState<TestQueryResults | null>(null);
  const { apiCall } = useAuth();
  const { memberUsernameOptions } = useMembers();
  const {
    datasources,
    getDatasourceById,
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
  const filteredDatasources = datasources.filter((d) => d.properties?.segments);

  const userIdType = form.watch("userIdType");
  const userEnteredQuery = form.watch("sql");

  console.log("userIdType", userIdType);

  const datasource = getDatasourceById(form.watch("datasource"));
  const dsProps = datasource?.properties;
  const sql = dsProps?.queryLanguage === "sql";

  const requiredColumns = useMemo(() => {
    return new Set([userIdType, "date"]);
  }, [userIdType]);

  const handleTestQuery = async () => {
    setTestQueryResults(null);
    try {
      validateSQL(userEnteredQuery, [...requiredColumns]);

      const res: TestQueryResults = await apiCall("/query/test", {
        method: "POST",
        body: JSON.stringify({
          query: userEnteredQuery,
          datasourceId: datasource.id,
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
      header={current ? "Edit Segment" : "New Segment"}
      submit={form.handleSubmit(async (value) => {
        if (sql) {
          validateSQL(value.sql, [value.userIdType, "date"]);
        }

        await apiCall(current.id ? `/segments/${current.id}` : `/segments`, {
          method: current.id ? "PUT" : "POST",
          body: JSON.stringify(value),
        });
        mutateDefinitions({});
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
        options={filteredDatasources.map((d) => ({
          value: d.id,
          label: d.name,
        }))}
      />
      {datasource.properties.userIds && (
        <SelectField
          label="Identifier Type"
          required
          value={userIdType}
          onChange={(v) => form.setValue("userIdType", v)}
          options={(datasource?.settings?.userIdTypes || []).map((t) => {
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
                placeholder={`SELECT\n      ${userIdType}, date\nFROM\n      mytable`}
                helpText={
                  <>
                    Select two columns named <code>{userIdType}</code> and{" "}
                    <code>date</code>
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
          placeholder={"event.properties.$browser === 'Chrome'"}
          helpText={
            <>
              Javascript condition used to filter events. Has access to an{" "}
              <code>event</code> variable.
            </>
          }
        />
      )}
    </Modal>
  );
};
export default SegmentForm;
