import { FC, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { DimensionInterface } from "back-end/types/dimension";
import { validateSQL } from "@/services/datasources";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import Modal from "@/components/Modal";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import useMembers from "@/hooks/useMembers";
import SQLInputField from "@/components/SQLInputField";
import SchemaBrowser from "../SchemaBrowser";
import { CursorData } from "../Segments/SegmentForm";

const DimensionForm: FC<{
  close: () => void;
  current: Partial<DimensionInterface>;
}> = ({ close, current }) => {
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

  const [cursorData, setCursorData] = useState<null | CursorData>(null);
  const updateSqlInput = (sql: string) => {
    form.setValue("sql", sql);
  };

  const datasource = form.watch("datasource");
  const userIdType = form.watch("userIdType");

  const dsObj = getDatasourceById(datasource);
  const supportsSchemaBrowser = dsObj.properties.supportsInformationSchema;

  const dsProps = dsObj?.properties;
  const sql = dsProps?.queryLanguage === "sql";

  const requiredColumns = useMemo(() => {
    return new Set([userIdType, "value"]);
  }, [userIdType]);

  return (
    <Modal
      close={close}
      open={true}
      size={supportsSchemaBrowser ? "max" : "md"}
      header={current.id ? "Edit Dimension" : "New Dimension"}
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
          label: `${d.name}${d.description ? ` — ${d.description}` : ""}`,
        }))}
        className="portal-overflow-ellipsis"
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
          <div
            className={supportsSchemaBrowser ? "col-xs-12 col-sm-7" : "col-12"}
          >
            <SQLInputField
              userEnteredQuery={form.watch("sql")}
              datasourceId={dsObj.id}
              form={form}
              requiredColumns={requiredColumns}
              setCursorData={setCursorData}
              placeholder={`SELECT\n      ${userIdType}, browser as value\nFROM\n      users`}
              helpText={
                <>
                  Select two columns named <code>{userIdType}</code> and{" "}
                  <code>value</code>
                </>
              }
              queryType="dimension"
            />
          </div>
          {supportsSchemaBrowser && (
            <div className="d-none d-sm-block col-5">
              <SchemaBrowser
                updateSqlInput={updateSqlInput}
                datasource={dsObj}
                cursorData={cursorData}
              />
            </div>
          )}
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
