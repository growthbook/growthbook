import { Router } from "express";
import { postCodeRefs } from "./postCodeRefs.js";
import { getCodeRefs } from "./getCodeRefs.js";
import { listCodeRefs } from "./listCodeRefs.js";

const router = Router();

router.post("/", postCodeRefs);
router.get("/", listCodeRefs);
router.get("/:id", getCodeRefs);

export default router;
