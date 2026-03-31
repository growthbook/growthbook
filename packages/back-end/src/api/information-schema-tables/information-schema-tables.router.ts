import { Router } from "express";
import { getInformationSchemaTable } from "./getInformationSchemaTable";

const router = Router();

// Information Schema Table Endpoints
// Mounted at /api/v1/information-schema-tables
router.get("/:tableId", getInformationSchemaTable);

export default router;
