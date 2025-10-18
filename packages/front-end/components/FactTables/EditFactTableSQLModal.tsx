import { useRef, useState } from "react";
import { FactTableInterface } from "back-end/types/fact-table";
import EditSqlModal from "@/components/SchemaBrowser/EditSqlModal";
import { useDefinitions } from "@/services/DefinitionsContext";

export interface Props {
  factTable: Pick<
    FactTableInterface,
    "datasource" | "sql" | "eventName" | "userIdTypes"
  >;
  requiredColumns?: Set<string>;
  close: () => void;
  save: (data: {
    sql: string;
    eventName: string;
    userIdTypes: string[];
  }) => Promise<void>;
  disableTestQueryBeforeSaving?: boolean;
}

export default function EditFactTableSQLModal({
  factTable,
  close,
  save,
  requiredColumns,
  disableTestQueryBeforeSaving,
}: Props) {
  const { getDatasourceById } = useDefinitions();
  const [eventName, setEventName] = useState(factTable.eventName);
  // useState is not updated unitl a re-render, so use useRef instead for this
  const userIdTypes = useRef(factTable.userIdTypes);

  const selectedDataSource = getDatasourceById(factTable.datasource);

  return (
    <EditSqlModal
      disableTestQueryBeforeSaving={disableTestQueryBeforeSaving}
      close={close}
      datasourceId={factTable.datasource}
      placeholder={
        "SELECT\n      user_id as user_id, timestamp as timestamp\nFROM\n      test"
      }
      requiredColumns={new Set(["timestamp", ...(requiredColumns || [])])}
      value={factTable.sql}
      save={async (sql) => {
        await save({
          eventName,
          userIdTypes: userIdTypes.current,
          sql,
        });
      }}
      templateVariables={{
        eventName: eventName,
      }}
      setTemplateVariables={({ eventName }) => {
        setEventName(eventName || "");
      }}
      validateResponseOverride={(response) => {
        if (!("timestamp" in response)) {
          throw new Error("Must select a column named 'timestamp'");
        }

        const possibleUserIdTypes =
          selectedDataSource?.settings?.userIdTypes?.map((t) => t.userIdType) ||
          [];

        const cols = Object.keys(response);
        const newUserIdTypes: string[] = [];
        for (const col of cols) {
          if (possibleUserIdTypes.includes(col)) {
            newUserIdTypes.push(col);
          }
        }

        if (!newUserIdTypes.length) {
          throw new Error(
            `You must select at least 1 of the following identifier columns: ${possibleUserIdTypes.join(
              ", ",
            )}`,
          );
        }

        userIdTypes.current = newUserIdTypes;
      }}
    />
  );
}
