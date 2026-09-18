import {
  DataSourceInterfaceWithParams,
  SchemaFormat,
} from "shared/types/datasource";
import { ChangeEventHandler } from "react";
import Field from "@/components/Forms/Field";
import { eventSchemas } from "@/services/eventSchema";

// Only schemas whose options feed generated resources (fact tables, metrics)
// are editable after creation. Options that only shape the initial SQL
// (e.g. Segment's exposure table name) are baked in at creation time.
const EDITABLE_OPTION_SCHEMAS: SchemaFormat[] = [
  "amplitude",
  "langfuse",
  "phoenix",
];

export interface Props {
  datasource: Partial<DataSourceInterfaceWithParams>;
  setDatasource: (newVal: Partial<DataSourceInterfaceWithParams>) => void;
  setDirty?: (dirty: boolean) => void;
}

export default function EditSchemaOptions({
  datasource,
  setDatasource,
  setDirty,
}: Props) {
  const setSchemaOptions = (schemaOptions: { [key: string]: string }) => {
    const newVal = {
      ...datasource,
      settings: {
        ...datasource.settings,
        schemaOptions: {
          ...datasource.settings?.schemaOptions,
          ...schemaOptions,
        },
      },
    };

    setDatasource(newVal as Partial<DataSourceInterfaceWithParams>);
    setDirty && setDirty(true);
  };
  const onParamChange: ChangeEventHandler<HTMLInputElement> = (e) => {
    setSchemaOptions({ [e.target.name]: e.target.value });
  };

  const schemaFormat = datasource.settings?.schemaFormat;
  if (!schemaFormat || !EDITABLE_OPTION_SCHEMAS.includes(schemaFormat)) {
    return null;
  }
  const schema = eventSchemas.find((s) => s.value === schemaFormat);
  if (!schema?.options?.length) {
    return null;
  }

  return (
    <div>
      {schema.options.map(({ name, label, type, helpText }) => (
        <Field
          key={name}
          size="legacy"
          type={type}
          className="form-control"
          name={name}
          label={label}
          helpText={helpText}
          value={String(datasource.settings?.schemaOptions?.[name] ?? "")}
          onChange={onParamChange}
        />
      ))}
    </div>
  );
}
