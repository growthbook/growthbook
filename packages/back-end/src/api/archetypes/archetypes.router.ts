import { Router } from "express";
import { listArchetypes } from "./listArchetypes";
import { postArchetype } from "./postArchetype";
import { getArchetype } from "./getArchetype";
import { putArchetype } from "./putArchetype";
import { deleteArchetype } from "./deleteArchetype";

const router = Router();

router.get("/", listArchetypes);
router.post("/", postArchetype);
router.get("/:id", getArchetype);
router.put("/:id", putArchetype);
router.delete("/:id", deleteArchetype);

export default router;
