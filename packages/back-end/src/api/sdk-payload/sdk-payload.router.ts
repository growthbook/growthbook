import { Router } from "express";
import { getSdkPayload } from "./getSdkPayload.js";

const router = Router();

// Private features SDK payload endpoint (for proxies / edge workers):
// Mounted at /api/v1/sdk-payload
router.get("/:key?", getSdkPayload);
// For preflight requests
router.options("/:key?", (req, res) => res.send(200));

export default router;
