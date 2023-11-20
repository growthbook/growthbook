import { Router } from "express";
import { getUser } from "./getUser";
import { createUser } from "./createUser";
import { listUsers } from "./listUsers";
import { patchUser } from "./patchUser";

const router = Router();

// User Endpoints
// Mounted at /scim/v2/users
router.get("/", listUsers);
router.get("/:id", getUser);
router.post("/", createUser);
router.patch("/:id", patchUser); // For Okta: Only used for user activation & deactivation (and password sync but that shouldn't be relevant)

export default router;
