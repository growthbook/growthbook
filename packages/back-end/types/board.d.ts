export type BoardColumnType =
  | "backlog"
  | "prioritized"
  | "running"
  | "stopped"
  | "archived";

export interface BoardColumn {
  type: BoardColumnType;
  display: string;
  experiments: string[];
}

export interface BoardInterface {
  organization: string;
  columns: BoardColumn[];
}
