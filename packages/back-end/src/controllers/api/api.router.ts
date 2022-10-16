import { Router } from "express";
import authencateApiRequestMiddleware from "../../middleware/authenticateApiRequestMiddleware";
import { getBuild } from "../../util/handler";
import { listFeatures } from "./features.controller";

const router = Router();

router.use(authencateApiRequestMiddleware);

// Index health check route
router.get("/", (req, res) => {
  res.json({
    name: "GrowthBook API",
    apiVersion: 1,
    build: getBuild(),
  });
});

// Feature Endpoints
router.get("/features", listFeatures);

// 404 route
router.use(function (req, res) {
  res.status(404).json({
    message: "Unknown API endpoint",
  });
});

export default router;
