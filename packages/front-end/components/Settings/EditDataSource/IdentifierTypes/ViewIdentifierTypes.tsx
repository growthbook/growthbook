import { DataSourceQueryEditingModalBaseProps } from "../types";
import { FC } from "react";

type ViewIdentifierTypesProps = DataSourceQueryEditingModalBaseProps;

export const ViewIdentifierTypes: FC<ViewIdentifierTypesProps> = ({
  dataSource,
  onSave,
  onCancel,
}) => {
  return <h1>ViewIdentifierTypes</h1>;
};
