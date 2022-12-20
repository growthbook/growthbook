import express from "express";
import { wrapController } from "../wrapController";
import { IS_CLOUD } from "../../util/secrets";
import * as organizationsControllerRaw from "./organizations.controller";

const router = express.Router();

const organizationsController = wrapController(organizationsControllerRaw);

router.get("/organization/definitions", organizationsController.getDefinitions);
router.get("/activity", organizationsController.getActivityFeed);
router.get("/history/:type", organizationsController.getAllHistory);
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
router.get("/invite/:key", organizationsController.getInviteInfo);
router.post("/invite/accept", organizationsController.postInviteAccept);
router.post("/invite", organizationsController.postInvite);
router.post("/invite/resend", organizationsController.postInviteResend);
router.put("/invite/:key/role", organizationsController.putInviteRole);
router.delete("/invite", organizationsController.deleteInvite);
router.delete("/member/:id", organizationsController.deleteMember);
router.put("/member/:id/role", organizationsController.putMemberRole);
router.put(
  "/member/:id/admin-password-reset",
  organizationsController.putAdminResetUserPassword
);
router.put("/organization/license", organizationsController.putLicenseKey);

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

// Orphaned users (users not part of an organization)
// Only available when self-hosting
if (!IS_CLOUD) {
  router.get("/orphaned-users", organizationsController.getOrphanedUsers);
  router.post(
    "/orphaned-users/:id/delete",
    organizationsController.deleteOrphanedUser
  );
  router.post(
    "/orphaned-users/:id/add",
    organizationsController.addOrphanedUser
  );
}

export { router as organizationsRouter };
