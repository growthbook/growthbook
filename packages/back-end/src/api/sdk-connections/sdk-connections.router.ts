import { Router } from "express";
import { getSdkConnection } from "./getSdkConnection";
import { listSdkConnections } from "./listSdkConnections";
import { postSdkConnection } from "./postSdkConnection";
import { putSdkConnection } from "./putSdkConnection";
import { deleteSdkConnection } from "./deleteSdkConnection";

const router = Router();

// Mounted at /api/v1/sdk-connections
router.get("/", listSdkConnections);
router.post("/", postSdkConnection);
router.get("/:id", getSdkConnection);
router.put("/:id", putSdkConnection);
router.delete("/:id", deleteSdkConnection);

export default router;
