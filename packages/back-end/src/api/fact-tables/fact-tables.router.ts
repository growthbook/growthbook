import { Router } from "express";
import { getFactTable } from "./getFactTable.js";
import { listFactTables } from "./listFactTables.js";
import { postFactTable } from "./postFactTable.js";
import { updateFactTable } from "./updateFactTable.js";
import { deleteFactTable } from "./deleteFactTable.js";
import { listFactTableFilters } from "./listFactTableFilters.js";
import { postFactTableFilter } from "./postFactTableFilter.js";
import { getFactTableFilter } from "./getFactTableFilter.js";
import { updateFactTableFilter } from "./updateFactTableFilter.js";
import { deleteFactTableFilter } from "./deleteFactTableFilter.js";

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
