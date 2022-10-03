import express from "express";
import asyncHandler from "express-async-handler";
import {
  deleteFeatureApi,
  getFeatureApi,
  getHealthCheck,
  listFeaturesApi,
  postFeatureApi,
  putFeatureApi,
} from "../../controllers/api/v1";
import { validateAccessTokenApiReq } from "../../middleware/validateAccessTokenApiReq";

const router = express.Router();

//Validates the access token for the listed api requests
router.use(validateAccessTokenApiReq());

//API routes that require an access token
router.get("/healthcheck", asyncHandler(getHealthCheck));
router.get("/features/:featureId", asyncHandler(getFeatureApi));
router.get("/features", asyncHandler(listFeaturesApi));
router.post("/features/:featureId", asyncHandler(postFeatureApi));
router.put("/features/:featureId", asyncHandler(putFeatureApi));
router.delete("/features/:featureId", asyncHandler(deleteFeatureApi));

export { router as apiV1Router };
