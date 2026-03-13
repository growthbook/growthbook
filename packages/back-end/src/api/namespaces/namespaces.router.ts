import { Router } from "express";
import { listNamespaces } from "./listNamespaces";
import { getNamespace } from "./getNamespace";
import { postNamespace } from "./postNamespace";
import { putNamespace } from "./putNamespace";
import { deleteNamespace } from "./deleteNamespace";

const router = Router();

// Namespace Endpoints
// Mounted at /api/v1/namespaces
router.get("/", listNamespaces);
router.post("/", postNamespace);
router.get("/:id", getNamespace);
router.put("/:id", putNamespace);
router.delete("/:id", deleteNamespace);

export default router;
