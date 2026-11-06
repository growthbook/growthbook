import express, { Request } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { wrapController } from "back-end/src/routers/wrapController";
import { validateRequestMiddleware } from "back-end/src/routers/utils/validateRequestMiddleware";
import * as rawLinkController from "./link.controller";

const router = express.Router();

const linkController = wrapController(rawLinkController);

// Guessing a code needs an account and gets this many tries an hour, per
// person. Per replica: the default MemoryStore isn't shared.
const attemptRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req as Request & AuthRequest).userId ?? req.ip ?? "",
  message: { message: "Too many attempts. Try again in an hour." },
});

const codeSchema = z.object({ code: z.string().max(20) }).strict();

router.get(
  "/info",
  attemptRateLimit,
  validateRequestMiddleware({ query: codeSchema }),
  linkController.getLinkInfo,
);
router.post(
  "/accept",
  attemptRateLimit,
  validateRequestMiddleware({ body: codeSchema }),
  linkController.postLinkAccept,
);

export { router as linkRouter };
