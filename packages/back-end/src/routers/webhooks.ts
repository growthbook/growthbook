import express from "express";
import {
  getWebhooks,
  postWebhook,
  putWebhook,
  deleteWebhook,
} from "../controllers/organizations";

const router = express.Router();

router.get("/webhooks", getWebhooks);
router.post("/webhooks", postWebhook);
router.put("/webhook/:id", putWebhook);
router.delete("/webhook/:id", deleteWebhook);

export { router as webhooksRouter };
