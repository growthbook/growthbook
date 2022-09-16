import express from "express";
import * as dimensionsController from "../controllers/dimensions";
import { wrapController } from "../services/routers";

wrapController(dimensionsController);

const router = express.Router();

router.get("/dimensions", dimensionsController.getAllDimensions);
router.post("/dimensions", dimensionsController.postDimensions);
router.put("/dimensions/:id", dimensionsController.putDimension);
router.delete("/dimensions/:id", dimensionsController.deleteDimension);

export { router as dimensionsRouter };
