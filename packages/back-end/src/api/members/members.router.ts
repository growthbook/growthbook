import { Router } from "express";
import { listMembers } from "./listMembers.js";
import { updateMemberRole } from "./updateMemberRole.js";
import { deleteMember } from "./deleteMember.js";

const router = Router();

// add permission middleware here?

// Project Endpoints
// Mounted at /api/v1/members
router.get("/", listMembers);
router.post("/:id/role", updateMemberRole);
router.delete("/:id", deleteMember);

export default router;
