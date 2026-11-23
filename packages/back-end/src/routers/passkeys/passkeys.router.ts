import express, { Request } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import {
  finishPasskeyRegistrationBodyValidator,
  renamePasskeyBodyValidator,
  startPasskeyRegistrationBodyValidator,
} from "shared/validators";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { wrapController } from "back-end/src/routers/wrapController";
import { validateRequestMiddleware } from "back-end/src/routers/utils/validateRequestMiddleware";
import * as passkeysControllerRaw from "./passkeys.controller";

const router = express.Router();

const passkeysController = wrapController(passkeysControllerRaw);

// Starting registration checks the password, so limit guesses. Per replica:
// the default MemoryStore isn't shared.
const registrationRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req as Request & AuthRequest).userId ?? req.ip ?? "",
  message: { message: "Too many attempts, please try again later" },
});

const passkeyIdParams = z.strictObject({ id: z.string() });

router.get("/", passkeysController.getPasskeys);
router.post(
  "/register/options",
  registrationRateLimit,
  validateRequestMiddleware({ body: startPasskeyRegistrationBodyValidator }),
  passkeysController.postRegistrationOptions,
);
router.post(
  "/register/verify",
  validateRequestMiddleware({ body: finishPasskeyRegistrationBodyValidator }),
  passkeysController.postRegistrationVerify,
);
router.put(
  "/:id",
  validateRequestMiddleware({
    params: passkeyIdParams,
    body: renamePasskeyBodyValidator,
  }),
  passkeysController.putPasskey,
);
router.delete(
  "/:id",
  validateRequestMiddleware({ params: passkeyIdParams }),
  passkeysController.deletePasskeyById,
);

export { router as passkeysRouter };
