import { Router } from "express";
import { listEnvironments } from "./listEnvironments";
import { putEnvironment } from "./putEnvironment";
import { postEnvironment } from "./postEnvironment";
import { deleteEnvironment } from "./deleteEnvironment";
import { postForkEnvironment } from "./postForkEnvironment";

const router = Router();

router.get("/", listEnvironments);
router.post("/", postEnvironment);
router.put("/:id", putEnvironment);
router.delete("/:id", deleteEnvironment);
router.post("/fork", postForkEnvironment);

export default router;
