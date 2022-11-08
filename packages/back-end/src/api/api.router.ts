import { Router, Request } from "express";
import authencateApiRequestMiddleware from "../middleware/authenticateApiRequestMiddleware";
import { getBuild } from "../util/handler";
import rateLimit from "express-rate-limit";
import { ApiRequestLocals } from "../../types/api";
import featuresRouter from "./features/features.router";
import bodyParser from "body-parser";

const router = Router();

router.use(bodyParser.json({ limit: "500kb" }));
router.use(bodyParser.urlencoded({ limit: "500kb", extended: true }));

router.use(authencateApiRequestMiddleware);

// Rate limit API keys to 60 requests per minute
router.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req: Request & ApiRequestLocals) => req.apiKey,
    message: { message: "Too many requests, limit to 60 per minute" },
  })
);

// Index health check route
router.get("/", (req, res) => {
  res.json({
    name: "GrowthBook API",
    apiVersion: 1,
    build: getBuild(),
  });
});

// API endpoints
router.use("/features", featuresRouter);

// 404 route
router.use(function (req, res) {
  res.status(404).json({
    message: "Unknown API endpoint",
  });
});

export default router;
