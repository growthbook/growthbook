import express from "express";
import * as organizationsControllerRaw from "./organizations.controller";
import { wrapController } from "../wrapController";

const router = express.Router();

const organizationsController = wrapController(organizationsControllerRaw);

router.get("/organization/definitions", organizationsController.getDefinitions);
router.get("/activity", organizationsController.getActivityFeed);
router.get("/history/:type/:id", organizationsController.getHistory);
router.get("/organization", organizationsController.getOrganization);
router.post("/organization", organizationsController.signup);
router.put("/organization", organizationsController.putOrganization);
router.post(
  "/organization/config/import",
  organizationsController.postImportConfig
);
router.get("/organization/namespaces", organizationsController.getNamespaces);
router.post("/organization/namespaces", organizationsController.postNamespaces);
router.put(
  "/organization/namespaces/:name",
  organizationsController.putNamespaces
);
router.delete(
  "/organization/namespaces/:name",
  organizationsController.deleteNamespace
);
router.post("/invite/accept", organizationsController.postInviteAccept);
router.post("/invite", organizationsController.postInvite);
router.post("/invite/resend", organizationsController.postInviteResend);
router.put("/invite/:key/role", organizationsController.putInviteRole);
router.delete("/invite", organizationsController.deleteInvite);
router.get("/members", organizationsController.getUsers);
router.delete("/member/:id", organizationsController.deleteMember);
router.put("/member/:id/role", organizationsController.putMemberRole);
router.put(
  "/member/:id/admin-password-reset",
  organizationsController.putAdminResetUserPassword
);

// API keys
router.get("/keys", organizationsController.getApiKeys);
router.post("/keys", organizationsController.postApiKey);
router.delete("/keys", organizationsController.deleteApiKey);
router.post("/keys/reveal", organizationsController.postApiKeyReveal);

// Webhooks
router.get("/webhooks", organizationsController.getWebhooks);
router.post("/webhooks", organizationsController.postWebhook);
router.put("/webhook/:id", organizationsController.putWebhook);
router.delete("/webhook/:id", organizationsController.deleteWebhook);

export { router as organizationsRouter };
