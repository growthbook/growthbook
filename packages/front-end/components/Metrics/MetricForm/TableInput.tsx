import { InformationSchemaInterface } from "@/../back-end/src/types/Integration";
import useApi from "@/hooks/useApi";
import TypeaheadInput from "./TypeaheadInput";

type Props = {
  datasourceId: string;
  value: string;
  onChange: (e: string, id: string) => void;
  label: string;
};

export default function TableInput({
  datasourceId,
  value,
  onChange,
  label,
}: Props) {
  const items = [];
  const { data } = useApi<{
    informationSchema: InformationSchemaInterface;
  }>(`/datasource/${datasourceId}/schema`);

  const informationSchema = data?.informationSchema;

  if (informationSchema?.databases.length) {
    informationSchema.databases.forEach((database) => {
      database.schemas.forEach((schema) => {
        schema.tables.forEach((table) => {
          items.push({ item: { name: table.tableName, id: table.id } });
        });
      });
    });
  }

  return (
    <TypeaheadInput
      label={label}
      value={value}
      items={items}
      onChange={onChange}
      filterKeys={["tableName"]}
      placeholder="Enter a table name"
    />
  );
}
