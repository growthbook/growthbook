import { DataSourceInterfaceWithParams } from "back-end/types/datasource";

export type DataSourceUIMode = "edit" | "view" | "add";

export type DataSourceEditingResourceType =
  // id: dataSource.settings.queries[x].userIdTypes[y].userIdType
  | "identifier_types"
  // id: dataSource.settings.queries[x].exposure[y].id
  | "experiment_assignment"
  // id: dataSource.settings.queries[x].identityJoins[y].ids
  | "identifier_join"
  // id: dataSource.settings.notebookRunQuery
  | "jupyter_notebook";

export type DataSourceQueryEditingModalBaseProps = {
  dataSource: DataSourceInterfaceWithParams;
  onSave: (dataSource: DataSourceInterfaceWithParams) => Promise<void>;
  onCancel: () => void;
  canEdit?: boolean;
};
