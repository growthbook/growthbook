import express from "express";
import * as authController from "../controllers/auth";
import { wrapController } from "../services/routers";
import { IS_CLOUD } from "../util/secrets";

wrapController(authController);

const router = express.Router();

// Pre-auth requests
// Managed cloud deployment uses Auth0 instead
if (!IS_CLOUD) {
  router.post("/refresh", authController.postRefresh);
  router.post("/login", authController.postLogin);
  router.post("/logout", authController.postLogout);
  router.post("/register", authController.postRegister);
  router.post("/firsttime", authController.postFirstTimeRegister);
  router.post("/forgot", authController.postForgotPassword);
  router.get("/reset/:token", authController.getResetPassword);
  router.post("/reset/:token", authController.postResetPassword);
}
router.get("/hasorgs", authController.getHasOrganizations);

export { router as preAuthRouter };
