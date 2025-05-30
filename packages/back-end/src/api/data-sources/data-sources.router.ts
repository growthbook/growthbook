import { Router } from "express";
import { getDataSource } from "./getDataSource";
import { listDataSources } from "./listDataSources";
import { postDataSource } from "./postDataSource";
import { putDataSource } from "./updateDataSource";

const router = Router();

// DataSource Endpoints
// Mounted at /api/v1/data-sources
router.get("/", listDataSources);
router.post("/", postDataSource);
router.get("/:id", getDataSource);
router.put("/:id", putDataSource);

export default router;
