import { Router } from "express";
import { getVisualChangeset } from "./getVisualChangeset.js";
import { postVisualChange } from "./postVisualChange.js";
import { putVisualChange } from "./putVisualChange.js";
import { putVisualChangeset } from "./putVisualChangeset.js";

const router = Router();

// VisualChangeset Endpoints
// Mounted at /api/v1/visual-changesets
router.get("/:id", getVisualChangeset);
router.put("/:id", putVisualChangeset);
router.post("/:id/visual-change", postVisualChange);
router.put("/:id/visual-change/:visualChangeId", putVisualChange);

// See experiment router for 'get all' endpoint

export default router;
