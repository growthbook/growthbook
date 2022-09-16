import express from "express";
import * as organizationsController from "../controllers/organizations";
import * as datasourcesController from "../controllers/datasources";
import * as stripeController from "../controllers/stripe";
import { wrapController } from "../services/routers";

wrapController(organizationsController);
wrapController(datasourcesController);
wrapController(stripeController);

const router = express.Router();

// Organization and Settings
router.put("/user/name", organizationsController.putUserName);
router.get("/user/watching", organizationsController.getWatchedItems);
router.post("/user/watch/:type/:id", organizationsController.postWatchItem);
router.post("/user/unwatch/:type/:id", organizationsController.postUnwatchItem);
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
router.post("/oauth/google", datasourcesController.postGoogleOauthRedirect);
router.post("/subscription/checkout", stripeController.postNewSubscription);
router.get("/subscription/quote", stripeController.getSubscriptionQuote);
router.post("/subscription/manage", stripeController.postCreateBillingSession);
router.post("/subscription/success", stripeController.postSubscriptionSuccess);
router.get("/queries/:ids", datasourcesController.getQueries);
router.post("/organization/sample-data", datasourcesController.postSampleData);
router.put(
  "/member/:id/admin-password-reset",
  organizationsController.putAdminResetUserPassword
);

export { router as organizationsRouter };
