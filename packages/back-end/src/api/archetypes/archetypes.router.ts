import { Router } from "express";
import { listArchetypes } from "./listArchetypes.js";
import { postArchetype } from "./postArchetype.js";
import { getArchetype } from "./getArchetype.js";
import { putArchetype } from "./putArchetype.js";
import { deleteArchetype } from "./deleteArchetype.js";

const router = Router();

router.get("/", listArchetypes);
router.post("/", postArchetype);
router.get("/:id", getArchetype);
router.put("/:id", putArchetype);
router.delete("/:id", deleteArchetype);

export default router;
