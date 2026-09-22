import { RequestHandler, Router } from "express";
import { getUser } from "./getUser";
import { createUser } from "./createUser";
import { listUsers } from "./listUsers";
import { patchUser } from "./patchUser";
import { putUser } from "./putUser";
import { deleteUser } from "./deleteUser";

const router = Router();

// User Endpoints
// Mounted at /scim/v2/users
router.get("/", listUsers as unknown as RequestHandler);
router.get("/:id", getUser as unknown as RequestHandler);
router.post("/", createUser as unknown as RequestHandler);
router.patch("/:id", patchUser as unknown as RequestHandler); // For Okta: Only used for user activation & deactivation (and password sync but that shouldn't be relevant)
router.put("/:id", putUser as unknown as RequestHandler); // Only supports updating user's global role
router.delete("/:id", deleteUser as unknown as RequestHandler); // OneLogin (and others) DELETE deactivates instead of hard-deleting

export default router;
