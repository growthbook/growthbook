import { Router } from "express";
import { postCodeRefs } from "./postCodeRefs";

const router = Router();

router.post("/", postCodeRefs);

export default router;
