import { Router } from "express";
import { listMembers } from "./listMembers";
import { updateMemberRole } from "./updateMemberRole";
import { deleteMember } from "./deleteMember";

const router = Router();

// add permission middleware here?

// Project Endpoints
// Mounted at /api/v1/members
router.get("/", listMembers);
router.post("/:id/role", updateMemberRole);
router.delete("/:id", deleteMember);

export default router;
