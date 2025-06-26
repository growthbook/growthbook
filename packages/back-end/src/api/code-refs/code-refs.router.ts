import { Router } from "express";
import { postCodeRefs } from "./postCodeRefs";
import { getCodeRefs } from "./getCodeRefs";

const router = Router();

router.post("/", postCodeRefs);
router.get("/:id", getCodeRefs);

export default router;
