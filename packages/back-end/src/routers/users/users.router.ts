import express, { Request } from "express";
import rateLimit from "express-rate-limit";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { wrapController } from "back-end/src/routers/wrapController";
import * as usersControllerRaw from "./users.controller";

const router = express.Router();

const usersController = wrapController(usersControllerRaw);

// One survey produces at most a couple of posts per 90-day cycle, and every
// valid response is relayed to an internal Slack channel, so the cap is sized
// for that rather than for general API traffic. A per-minute window still let a
// scripted client through ~28k messages a day; an hour-long window keeps ample
// headroom for staff re-testing via ?show-nps while cutting that by two orders
// of magnitude. Note this is express-rate-limit's default in-process
// MemoryStore, so the ceiling is per replica and resets on deploy.
const npsResponseRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
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
