import express from "express";
import { wrapController } from "@/src/routers//wrapController";
import * as usersControllerRaw from "./users.controller";

const router = express.Router();

const usersController = wrapController(usersControllerRaw);

router.get("/", usersController.getUser);
router.put("/name", usersController.putUserName);
router.get("/watching", usersController.getWatchedItems);
router.post("/watch/:type/:id", usersController.postWatchItem);
router.post("/unwatch/:type/:id", usersController.postUnwatchItem);
router.get("/getRecommendedOrg", usersController.getRecommendedOrg);

export { router as usersRouter };
