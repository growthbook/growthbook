import { DataSourceInterfaceWithParams } from "shared/types/datasource";
import { ChangeEventHandler } from "react";
import Tooltip from "@/components/Tooltip/Tooltip";
import Field from "@/components/Forms/Field";

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

  if (datasource.settings?.schemaFormat === "amplitude") {
    return (
      <div>
        <label>
          Amplitude Project ID{" "}
          <Tooltip body="This is required if you want to use our automatic metric generation. You can find this in your Amplitude account by going to your organizational settings and locating your project settings." />
        </label>
        <Field
          type="text"
          className="form-control"
          name="projectId"
          value={datasource.settings?.schemaOptions?.projectId || ""}
          onChange={onParamChange}
          placeholder="123456"
        />
      </div>
    );
  }

  return null;
}
