import { Router } from "express";
import { listSDKConnections } from "./listSdkConnections";

const router = Router();

// Mounted at /api/v1/sdk-connections
router.get("/", listSDKConnections);

export default router;
