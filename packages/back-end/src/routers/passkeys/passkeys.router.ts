import express, { Request } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import {
  finishPasskeyRegistrationBodyValidator,
  finishPasskeySignInBodyValidator,
  renamePasskeyBodyValidator,
  startPasskeyRegistrationBodyValidator,
} from "shared/validators";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { wrapController } from "back-end/src/routers/wrapController";
import { validateRequestMiddleware } from "back-end/src/routers/utils/validateRequestMiddleware";
import {
  postPasskeySignInOptions,
  postPasskeySignInVerify,
} from "back-end/src/controllers/auth";
import * as passkeysControllerRaw from "./passkeys.controller";

const router = express.Router();

const passkeysController = wrapController(passkeysControllerRaw);
// Only the two sign-in handlers; the rest of the auth controller is wrapped in
// app.ts
const signInController = wrapController({
  postPasskeySignInOptions,
  postPasskeySignInVerify,
});

// Starting registration checks the password, so limit guesses. Per replica:
// the default MemoryStore isn't shared.
const registrationRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req as Request & AuthRequest).userId ?? req.ip ?? "",
  message: { message: "Too many attempts. Please try again later." },
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

// Sign-in runs before login, so this router is mounted without auth
const signInRouter = express.Router();

const signInRateLimit = (max: number) =>
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: "Too many sign-in attempts. Please try again later." },
  });

// Each options request stores a challenge, so cap anonymous callers per IP.
// The login page asks for one on every visit to offer passkeys in autofill,
// and without EXPRESS_TRUST_PROXY_OPTS everyone behind a proxy shares an IP.
signInRouter.post(
  "/options",
  signInRateLimit(100),
  signInController.postPasskeySignInOptions,
);
signInRouter.post(
  "/verify",
  signInRateLimit(30),
  validateRequestMiddleware({ body: finishPasskeySignInBodyValidator }),
  signInController.postPasskeySignInVerify,
);

export { router as passkeysRouter, signInRouter as passkeySignInRouter };
