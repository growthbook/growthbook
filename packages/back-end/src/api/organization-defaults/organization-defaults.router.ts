import { Router } from "express";
import { getOrganizationDefaults } from "./getOrganizationDefaults";

const router = Router();

router.get("/", getOrganizationDefaults);

export default router;
