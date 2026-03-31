import { Router } from "express";
import { getDataSource } from "./getDataSource";
import { getInformationSchema } from "./getInformationSchema";
import { listDataSources } from "./listDataSources";

const router = Router();

// DataSource Endpoints
// Mounted at /api/v1/data-sources
router.get("/", listDataSources);
router.get("/:id", getDataSource);
router.get("/:dataSourceId/information-schema", getInformationSchema);

export default router;
