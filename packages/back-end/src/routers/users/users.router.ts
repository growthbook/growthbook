import express, { Request } from "express";
import rateLimit from "express-rate-limit";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { wrapController } from "back-end/src/routers/wrapController";
import * as usersControllerRaw from "./users.controller";

const router = express.Router();

const usersController = wrapController(usersControllerRaw);

// One survey produces at most a couple of posts, and each valid response is
// relayed to an internal Slack channel, so cap it per user: plenty of headroom
// for normal use (and for staff re-testing via ?show-nps) while stopping a
// scripted client from flooding the channel.
const npsResponseRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req as Request & AuthRequest).userId ?? req.ip ?? "",
  message: { message: "Too many NPS responses, please try again later" },
});

router.get("/", usersController.getUser);
router.put("/name", usersController.putUserName);
router.post(
  "/nps-response",
  npsResponseRateLimit,
  usersController.postNpsResponse,
);
router.post("/watch/:type/:id", usersController.postWatchItem);
router.post("/unwatch/:type/:id", usersController.postUnwatchItem);
router.get("/getRecommendedOrgs", usersController.getRecommendedOrgs);
router.get("/history", usersController.getHistoryByUser);

export { router as usersRouter };
