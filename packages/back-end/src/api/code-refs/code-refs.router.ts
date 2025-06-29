import { Router } from "express";
import { postCodeRefs } from "./postCodeRefs";
import { getCodeRefs } from "./getCodeRefs";
import { listCodeRefs } from "./listCodeRefs";

const router = Router();

router.post("/", postCodeRefs);
router.get("/", listCodeRefs);
router.get("/:id", getCodeRefs);

export default router;
