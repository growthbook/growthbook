import { Router } from "express";
import { getDataSource } from "./getDataSource";
import { listDataSources } from "./listDataSources";

const router = Router();

// DataSource Endpoints
// Mounted at /api/v1/data-sources
router.get("/", listDataSources);
router.get("/:id", getDataSource);

export default router;
