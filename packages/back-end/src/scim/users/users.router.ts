import { Router } from "express";
import { getUser } from "./getUser.js";
import { createUser } from "./createUser.js";
import { listUsers } from "./listUsers.js";
import { patchUser } from "./patchUser.js";
import { putUser } from "./putUser.js";

const router = Router();

// User Endpoints
// Mounted at /scim/v2/users
router.get("/", listUsers);
router.get("/:id", getUser);
router.post("/", createUser);
router.patch("/:id", patchUser); // For Okta: Only used for user activation & deactivation (and password sync but that shouldn't be relevant)
router.put("/:id", putUser); // Only supports updating user's global role

export default router;
