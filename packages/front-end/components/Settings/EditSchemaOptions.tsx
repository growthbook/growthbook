import {
  DataSourceInterfaceWithParams,
  SchemaFormat,
} from "shared/types/datasource";
import { ChangeEventHandler } from "react";
import { Flex } from "@radix-ui/themes";
import TextField from "@/ui/TextField";
import { eventSchemas } from "@/services/eventSchema";

// Only options that feed generated resources (fact tables, metrics) are
// editable after creation; the rest only shape the initial exposure SQL.
const EDITABLE_OPTIONS: Partial<Record<SchemaFormat, string[]>> = {
  amplitude: ["projectId"],
  langfuse: ["projectId"],
  phoenix: ["projectName"],
};

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
  const editable = schemaFormat ? EDITABLE_OPTIONS[schemaFormat] : undefined;
  const options = (
    eventSchemas.find((s) => s.value === schemaFormat)?.options ?? []
  ).filter((o) => editable?.includes(o.name));
  if (!options.length) {
    return null;
  }

  return (
    <Flex direction="column" gap="3">
      {options.map(({ name, label, type, helpText }) => (
        <TextField
          key={name}
          type={type === "number" ? "number" : "text"}
          name={name}
          label={label}
          helpText={helpText}
          value={String(datasource.settings?.schemaOptions?.[name] ?? "")}
          onChange={onParamChange}
        />
      ))}
    </Flex>
  );
}
