import express from "express";
import { wrapController } from "back-end/src/routers/wrapController";
import { validateRequestMiddleware } from "back-end/src/routers/utils/validateRequestMiddleware";
import { IS_CLOUD } from "back-end/src/util/secrets";
import { putDefaultRoleValidator } from "./organizations.validators";
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
  organizationsController.postImportConfig,
);
router.post(
  "/organization/autoApproveMembers",
  organizationsController.postAutoApproveMembers,
);
router.get("/organization/namespaces", organizationsController.getNamespaces);
router.post("/organization/namespaces", organizationsController.postNamespaces);
router.put(
  "/organization/namespaces/:name",
  organizationsController.putNamespaces,
);
router.delete(
  "/organization/namespaces/:name",
  organizationsController.deleteNamespace,
);
router.post(
  "/organization/auto-groups-attribute",
  organizationsController.autoAddGroupsAttribute,
);
router.get("/invite/:key", organizationsController.getInviteInfo);
router.post("/invite/accept", organizationsController.postInviteAccept);
router.post("/invite", organizationsController.postInvite);
router.post("/invite/resend", organizationsController.postInviteResend);
router.put("/invite/:key/role", organizationsController.putInviteRole);
router.delete("/invite", organizationsController.deleteInvite);
router.put("/member", organizationsController.putMember);
router.post("/member/:id/approve", organizationsController.postMemberApproval);
router.delete("/member/:id", organizationsController.deleteMember);
router.put("/member/:id/role", organizationsController.putMemberRole);
router.put(
  "/member/:id/admin-password-reset",
  organizationsController.putAdminResetUserPassword,
);
router.put("/organization/license", organizationsController.putLicenseKey);
router.put(
  "/organization/default-role",
  validateRequestMiddleware({
    body: putDefaultRoleValidator,
  }),
  organizationsController.putDefaultRole,
);
router.put(
  "/organization/get-started-checklist",
  organizationsController.putGetStartedChecklistItem,
);
router.put(
  "/organization/setup-event-tracker",
  organizationsController.putSetupEventTracker,
);
router.get(
  "/organization/feature-exp-usage",
  organizationsController.getFeatureExpUsage,
);

// API keys
router.get("/keys", organizationsController.getApiKeys);
router.post("/keys", organizationsController.postApiKey);
router.delete("/keys", organizationsController.deleteApiKey);
router.post("/keys/reveal", organizationsController.postApiKeyReveal);

// Legacy Webhooks
router.get("/legacy-sdk-webhooks", organizationsController.getLegacyWebhooks);
router.delete(
  "/legacy-sdk-webhooks/:id",
  organizationsController.deleteLegacyWebhook,
);

// SDK Webhooks
router.put("/sdk-webhooks/:id", organizationsController.putSDKWebhook);
router.delete("/sdk-webhooks/:id", organizationsController.deleteSDKWebhook);
router.post("/sdk-webhooks/:id/test", organizationsController.testSDKWebhook);

// Orphaned users (users not part of an organization)
// Only available when self-hosting
if (!IS_CLOUD) {
  router.get("/orphaned-users", organizationsController.getOrphanedUsers);
  router.post(
    "/orphaned-users/:id/delete",
    organizationsController.deleteOrphanedUser,
  );
  router.post(
    "/orphaned-users/:id/add",
    organizationsController.addOrphanedUser,
  );
}

// Custom Roles
router.post("/custom-roles", organizationsController.postCustomRole);
router.put("/custom-roles/:id", organizationsController.putCustomRole);
router.delete("/custom-roles/:id", organizationsController.deleteCustomRole);

// Standard Roles
router.post("/role/:id/deactivate", organizationsController.deactivateRole);
router.post("/role/:id/activate", organizationsController.activateRole);

// Agreements:
router.post("/agreements/agree", organizationsController.postAgreeToAgreement);

export { router as organizationsRouter };
