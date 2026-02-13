import { Router } from "express";
import { getDataSource } from "./getDataSource.js";
import { listDataSources } from "./listDataSources.js";

const router = Router();

// DataSource Endpoints
// Mounted at /api/v1/data-sources
router.get("/", listDataSources);
router.get("/:id", getDataSource);

export default router;
