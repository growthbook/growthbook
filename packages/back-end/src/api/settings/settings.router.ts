import { Router } from "express";
import { getSettings } from "./getSettings";

const router = Router();

router.get("/", getSettings);

export default router;
