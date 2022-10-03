import express from "express";
import asyncHandler from "express-async-handler";
import { getHealthCheck, listFeaturesApi } from "../../controllers/api/v1";
import { validateAccessTokenApiReq } from "../../middleware/validateAccessTokenApiReq";

const router = express.Router();

//Validates the access token for the listed api requests
router.use(validateAccessTokenApiReq());

//API routes that require an access token
router.get("/healthcheck", asyncHandler(getHealthCheck));
router.get("/features", asyncHandler(listFeaturesApi));

export { router as apiV1Router };
