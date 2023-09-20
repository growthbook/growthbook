import { Router } from "express";
import { getUser } from "./getUser";
import { createUser } from "./createUser";
import { listUsers } from "./listUsers";

const router = Router();

// DataSource Endpoints
// Mounted at /scim/v2/users
router.get("/", listUsers);
router.get("/:id", getUser);
router.post("/", createUser);

export default router;
