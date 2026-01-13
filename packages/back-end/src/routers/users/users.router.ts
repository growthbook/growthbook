import express from "express";
import { wrapController } from "back-end/src/routers/wrapController";
import * as usersControllerRaw from "./users.controller";

const router = express.Router();

const usersController = wrapController(usersControllerRaw);

router.get("/", usersController.getUser);
router.put("/name", usersController.putUserName);
router.post("/watch/:type/:id", usersController.postWatchItem);
router.post("/unwatch/:type/:id", usersController.postUnwatchItem);
router.get("/getRecommendedOrgs", usersController.getRecommendedOrgs);
router.get("/history", usersController.getHistoryByUser);

export { router as usersRouter };
