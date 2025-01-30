import { Router } from "express";
import { getAllHistory } from "./getAllHistory";
import { getHistory } from "./getHistory";

const router = Router();

router.get("/:type", getAllHistory);
router.get("/:type/:id", getHistory);

export default router;
