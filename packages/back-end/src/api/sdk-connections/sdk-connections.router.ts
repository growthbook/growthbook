import { Router } from "express";
import { getSdkConnection } from "./getSdkConnection.js";
import { listSdkConnections } from "./listSdkConnections.js";
import { postSdkConnection } from "./postSdkConnection.js";
import { putSdkConnection } from "./putSdkConnection.js";
import { deleteSdkConnection } from "./deleteSdkConnection.js";
import { lookupSdkConnectionByKey } from "./lookupSdkConnectionByKey.js";

const router = Router();

// Mounted at /api/v1/sdk-connections
router.get("/", listSdkConnections);
router.post("/", postSdkConnection);
router.get("/:id", getSdkConnection);
router.put("/:id", putSdkConnection);
router.delete("/:id", deleteSdkConnection);
router.get("/lookup/:key", lookupSdkConnectionByKey);

export default router;
