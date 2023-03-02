import { Router } from "express";
import { getSdkConnection } from "./getSdkConnection";
import { listSdkConnections } from "./listSdkConnections";

const router = Router();

// Mounted at /api/v1/sdk-connections
router.get("/", listSdkConnections);
router.get("/:id", getSdkConnection);

export default router;
