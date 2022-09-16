import express from "express";
import {
  getApiKeys,
  postApiKey,
  deleteApiKey,
} from "../controllers/organizations";

const router = express.Router();

router.get("/keys", getApiKeys);
router.post("/keys", postApiKey);
router.delete("/key/:key", deleteApiKey);

export { router as keysRouter };
