import express from "express";
import asyncHandler from "express-async-handler";
import { postRole, updateRole, deleteRole } from "../controllers/roles";

const router = express.Router();

router.post("/:roleId", asyncHandler(postRole));
router.put("/:roleId", asyncHandler(updateRole));
router.delete("/:roleId", asyncHandler(deleteRole));

export { router as rolesRouter };
