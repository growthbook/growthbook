import { FC, useMemo } from "react";
import { SegmentInterface } from "back-end/types/segment";
import { useForm } from "react-hook-form";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import { validateSQL } from "@/services/datasources";
import SQLInputField from "@/components/SQLInputField";
import { useAuth } from "@/services/auth";
import Modal from "@/components/Modal";
import useMembers from "@/hooks/useMembers";
import { useDefinitions } from "@/services/DefinitionsContext";
import DatasourceSchema from "../DatasourceSchema";

const SegmentForm: FC<{
  close: () => void;
  current: Partial<SegmentInterface>;
}> = ({ close, current }) => {
  const { apiCall } = useAuth();
  const { memberUsernameOptions } = useMembers();
  const {
    datasources,
    getDatasourceById,
    mutateDefinitions,
    getInformationSchemaById,
  } = useDefinitions();
  const filteredDatasources = datasources.filter((d) => d.properties?.segments);
  const form = useForm({
    defaultValues: {
      name: current.name || "",
      sql: current.sql || "",
      datasource:
        (current.id ? current.datasource : filteredDatasources[0]?.id) || "",
      userIdType: current.userIdType || "user_id",
      owner: current.owner || "",
    },
  });

  const userIdType = form.watch("userIdType");

  const datasource = getDatasourceById(form.watch("datasource"));

  const informationSchema = getInformationSchemaById(
    datasource.settings.informationSchemaId
  );

  const informationSchemaSupported = () =>
    datasource?.type === "postgres" || datasource?.type === "bigquery";

  const dsProps = datasource?.properties;
  const sql = dsProps?.queryLanguage === "sql";

  const requiredColumns = useMemo(() => {
    return new Set([userIdType, "date"]);
  }, [userIdType]);

  return (
    <Modal
      close={close}
      open={true}
      size="fill"
      header={current.id ? "Edit Segment" : "New Segment"}
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
          label: `${d.name}${d.description ? ` — ${d.description}` : ""}`,
        }))}
        className="portal-overflow-ellipsis"
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
        <div className="container">
          <div className="row">
            <div className="col-lg">
              <SQLInputField
                userEnteredQuery={form.watch("sql")}
                datasourceId={datasource.id}
                form={form}
                requiredColumns={requiredColumns}
                placeholder={`SELECT\n      ${userIdType}, date\nFROM\n      mytable`}
                helpText={
                  <>
                    Select two columns named <code>{userIdType}</code> and{" "}
                    <code>date</code>
                  </>
                }
                queryType="segment"
              />
            </div>
            {informationSchemaSupported() && (
              <DatasourceSchema
                datasource={datasource}
                informationSchema={informationSchema}
              />
            )}
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
