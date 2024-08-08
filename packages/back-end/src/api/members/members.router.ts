import { Router } from "express";
import { getMember } from "./getMember";
import { listMembers } from "./listMembers";
import { putMemberRole } from "./putMemberRole";
import { deleteMember } from "./deleteMember";

const router = Router();

// add permission middleware here?

// Project Endpoints
// Mounted at /api/v1/members
router.get("/", listMembers);
router.get("/:id", getMember);
router.put("/:id", putMemberRole);
router.delete("/:id", deleteMember);

export default router;
