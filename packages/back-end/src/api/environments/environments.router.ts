import { Router } from "express";
import { listEnvironments } from "./listEnvironments";
import { putEnvironment } from "./putEnvironment";
import { postEnvironment } from "./postEnvironment";
import { deleteEnvironment } from "./deleteEnvironment";

const router = Router();

router.get("/:environments", listEnvironments);
router.post("/environments", postEnvironment);
router.put("/environments/:environmentId", putEnvironment);
router.delete("/environments/:environmentId", deleteEnvironment);

export default router;
