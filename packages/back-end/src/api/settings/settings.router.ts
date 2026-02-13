import { Router } from "express";
import { getSettings } from "./getSettings.js";

const router = Router();

router.get("/", getSettings);

export default router;
