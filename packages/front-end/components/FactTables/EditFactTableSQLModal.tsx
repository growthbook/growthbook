import { isEqual } from "lodash";
import { useRef, useState } from "react";
import { FactTableInterface } from "back-end/types/fact-table";
import EditSqlModal from "@/components/SchemaBrowser/EditSqlModal";
import { useDefinitions } from "@/services/DefinitionsContext";

export interface Props {
  factTable: Pick<
    FactTableInterface,
    "datasource" | "sql" | "eventName" | "userIdTypes"
  >;
  close: () => void;
  save: (data: {
    sql: string;
    eventName: string;
    userIdTypes: string[];
  }) => Promise<void>;
}

export default function EditFactTableSQLModal({
  factTable,
  close,
  save,
}: Props) {
  const { getDatasourceById } = useDefinitions();
  const [eventName, setEventName] = useState(factTable.eventName);
  const userIdTypes = useRef(factTable.userIdTypes);

  const selectedDataSource = getDatasourceById(factTable.datasource);

  return (
    <EditSqlModal
      close={close}
      datasourceId={factTable.datasource}
      placeholder={
        "SELECT\n      user_id as user_id, timestamp as timestamp\nFROM\n      test"
      }
      requiredColumns={new Set(["timestamp"])}
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
        const possibleUserIdTypes =
          selectedDataSource?.settings?.userIdTypes?.map((t) => t.userIdType) ||
          [];

        const currentUserIdTypes = userIdTypes.current;

        const cols = Object.keys(response);
        const newUserIdTypes: string[] = [];
        for (const col of cols) {
          if (possibleUserIdTypes.includes(col)) {
            newUserIdTypes.push(col);
          }
        }

        if (!newUserIdTypes.length) {
          throw new Error(
            `You must select at least 1 identifier column from the list: ${possibleUserIdTypes.join(
              ", "
            )}`
          );
        }

        if (!isEqual(newUserIdTypes, currentUserIdTypes)) {
          userIdTypes.current = newUserIdTypes;
        }
      }}
    />
  );
}
