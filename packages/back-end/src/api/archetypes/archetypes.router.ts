import { Router } from "express";
import { listArchetypes } from "./listArchetypes";

const router = Router();

router.get("/", listArchetypes);

export default router;
