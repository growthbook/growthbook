import { Router } from "express";
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

const router = Router();

// FactTable Endpoints
// Mounted at /api/v1/fact-tables
router.get("/", listFactTables);
router.post("/", postFactTable);
router.get("/:id", getFactTable);
router.post("/:id", updateFactTable);
router.delete("/:id", deleteFactTable);

// FactTableFilter Endpoints
router.get("/:factTableId/filters", listFactTableFilters);
router.post("/:factTableId/filters", postFactTableFilter);
router.get("/:factTableId/filters/:id", getFactTableFilter);
router.post("/:factTableId/filters/:id", updateFactTableFilter);
router.delete("/:factTableId/filters/:id", deleteFactTableFilter);

export default router;
