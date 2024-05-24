import { Router } from "express";
import { listEnvironments } from "./listEnvironments";
import { putEnvironment } from "./putEnvironment";
import { postEnvironment } from "./postEnvironment";
import { deleteEnvironment } from "./deleteEnvironment";

const router = Router();

router.get("/", listEnvironments);
router.post("/", postEnvironment);
router.put("/:environmentId", putEnvironment);
router.delete("/:environmentId", deleteEnvironment);

export default router;
