import express from "express";
import * as datasourcesController from "../controllers/datasources";
import { wrapController } from "../services/routers";

wrapController(datasourcesController);

const router = express.Router();

router.get("/datasources", datasourcesController.getDataSources);
router.get("/datasource/:id", datasourcesController.getDataSource);
router.post("/datasources", datasourcesController.postDataSources);
router.put("/datasource/:id", datasourcesController.putDataSource);
router.delete("/datasource/:id", datasourcesController.deleteDataSource);

export { router as datasourcesRouter };
