import { Router } from "express";
import { listEnvironments } from "./listEnvironments.js";
import { putEnvironment } from "./putEnvironment.js";
import { postEnvironment } from "./postEnvironment.js";
import { deleteEnvironment } from "./deleteEnvironment.js";

const router = Router();

router.get("/", listEnvironments);
router.post("/", postEnvironment);
router.put("/:id", putEnvironment);
router.delete("/:id", deleteEnvironment);

export default router;
