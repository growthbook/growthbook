import { Router } from "express";
import { getQuery } from "./getQuery.js";

const router = Router();

router.get("/:id", getQuery);

export default router;
