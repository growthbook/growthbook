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
  // useState is not updated unitl a re-render, so use useRef instead for this
  const userIdTypes = useRef(factTable.userIdTypes);

  const selectedDataSource = getDatasourceById(factTable.datasource);
  const timestampColumn = getFactTableTimestampColumn(factTable);

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
        if (!(timestampColumn in response)) {
          throw new Error(`Must select a column named '${timestampColumn}'`);
        }

        const possibleUserIdTypes =
          selectedDataSource?.settings?.userIdTypes?.map((t) => t.userIdType) ||
          [];
        const identifierColumns = possibleUserIdTypes.map(
          (idType) => getFactTableIdColumn(factTable, idType).split(".")[0],
        );
        const newUserIdTypes = possibleUserIdTypes.filter(
          (idType) =>
            getFactTableIdColumn(factTable, idType).split(".")[0] in response,
        );

        if (!newUserIdTypes.length) {
          throw new Error(
            `You must select at least 1 of the following identifier columns: ${identifierColumns.join(
              ", ",
            )}`,
          );
        }

        userIdTypes.current = newUserIdTypes;
      }}
    />
  );
}
