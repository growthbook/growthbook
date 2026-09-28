import { useRef, useState } from "react";
import {
  getFactTableIdColumn,
  getFactTableTimestampColumn,
} from "shared/experiments";
import { FactTableInterface } from "shared/types/fact-table";
import EditSqlModal from "@/components/SchemaBrowser/EditSqlModal";
import { useDefinitions } from "@/services/DefinitionsContext";

export interface Props {
  factTable: Pick<
    FactTableInterface,
    | "datasource"
    | "sql"
    | "eventName"
    | "userIdTypes"
    | "userIdColumns"
    | "name"
    | "timestampColumn"
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
  // useState is not updated until a re-render, so use useRef instead for this.
  // Stays null unless a test query returns rows to narrow the id types from.
  const userIdTypesFromResults = useRef<string[] | null>(null);

  const selectedDataSource = getDatasourceById(factTable.datasource);
  const timestampColumn = getFactTableTimestampColumn(factTable);

  const possibleUserIdTypes =
    selectedDataSource?.settings?.userIdTypes?.map((t) => t.userIdType) || [];
  const getIdColumn = (idType: string) =>
    getFactTableIdColumn(factTable, idType).split(".")[0];

  // Without result rows (test skipped or no rows returned), keep the id types
  // whose columns appear in the SQL, matching the check validateSQL runs on save
  const getUserIdTypesFromSql = (sql: string) => {
    if (!possibleUserIdTypes.length) return factTable.userIdTypes;
    if (sql.match(/SELECT\s+\*/i)) return possibleUserIdTypes;
    return possibleUserIdTypes.filter((idType) =>
      sql.toLowerCase().includes(getIdColumn(idType).toLowerCase()),
    );
  };

  return (
    <EditSqlModal
      close={close}
      sqlObjectInfo={{ objectType: "Fact Table", objectName: factTable.name }}
      datasourceId={factTable.datasource}
      placeholder={`SELECT\n      user_id as user_id, ${timestampColumn} as ${timestampColumn}\nFROM\n      test`}
      requiredColumns={new Set([timestampColumn])}
      timestampColumn={timestampColumn}
      value={factTable.sql}
      save={async (sql) => {
        await save({
          eventName,
          userIdTypes:
            userIdTypesFromResults.current ?? getUserIdTypesFromSql(sql),
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
        if (!(timestampColumn in response)) {
          throw new Error(`Must select a column named '${timestampColumn}'`);
        }

        const identifierColumns = possibleUserIdTypes.map(getIdColumn);
        const newUserIdTypes = possibleUserIdTypes.filter(
          (idType) => getIdColumn(idType) in response,
        );

        if (!newUserIdTypes.length) {
          throw new Error(
            `You must select at least 1 of the following identifier columns: ${identifierColumns.join(
              ", ",
            )}`,
          );
        }

        userIdTypesFromResults.current = newUserIdTypes;
      }}
    />
  );
}
