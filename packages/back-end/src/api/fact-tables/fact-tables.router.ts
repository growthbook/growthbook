import { OpenApiRoute } from "back-end/src/util/handler";
import { getFactTable } from "./getFactTable";
import { listFactTables } from "./listFactTables";
import { postFactTable } from "./postFactTable";
import { updateFactTable } from "./updateFactTable";
import { deleteFactTable } from "./deleteFactTable";
import { listFactTableFilters } from "./listFactTableFilters";
import { postFactTableFilter } from "./postFactTableFilter";
import { getFactTableFilter } from "./getFactTableFilter";
import { updateFactTableFilter } from "./updateFactTableFilter";
import { deleteFactTableFilter } from "./deleteFactTableFilter";

export const factTablesRoutes: OpenApiRoute[] = [
  listFactTables,
  postFactTable,
  getFactTable,
  updateFactTable,
  deleteFactTable,
  listFactTableFilters,
  postFactTableFilter,
  getFactTableFilter,
  updateFactTableFilter,
  deleteFactTableFilter,
];
