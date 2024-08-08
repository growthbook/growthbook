import { Router } from "express";
import { getMember } from "./getMember";
import { listMembers } from "./listMembers";
import { putMemberRole } from "./putMemberRole";
import { removeMember } from "./removeMember";

const router = Router();

// add permission middleware here?

// Project Endpoints
// Mounted at /api/v1/members
router.get("/", listMembers);
router.get("/:id", getMember);
router.put("/:id", putMemberRole);
router.delete("/:id", removeMember);

export default router;
