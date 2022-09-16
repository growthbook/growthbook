import express from "express";
import { getOrganizations, addSampleData } from "../controllers/admin";

const router = express.Router();

router.get("/admin/organizations", getOrganizations);
router.post("/admin/organization/:id/populate", addSampleData);

export { router as adminRouter };
