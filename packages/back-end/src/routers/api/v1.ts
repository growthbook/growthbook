import express from "express";
import * as v1ApiController from "../../controllers/api/v1";
import validateAccessTokenApiReq from "../../middleware/validateAccessTokenApiReq";
import { wrapController } from "../../services/routers";

wrapController(v1ApiController);

const router = express.Router();

//Validates the access token for the listed api requests
router.use(validateAccessTokenApiReq());

//API routes that require an access token
router.get("/healthcheck", v1ApiController.getHealthCheck);
router.get("/features/:featureId", v1ApiController.getFeatureApi);
router.get("/features", v1ApiController.listFeaturesApi);
router.post("/features/:featureId", v1ApiController.postFeatureApi);
router.put("/features/:featureId", v1ApiController.putFeatureApi);
router.delete("/features/:featureId", v1ApiController.deleteFeatureApi);

export { router as apiV1Router };
