import { Router } from "express";
import { listRevisions } from "./listRevisions";

const router = Router();

// Mounted at /api/v1/revisions
router.get("/", listRevisions);

export default router;
