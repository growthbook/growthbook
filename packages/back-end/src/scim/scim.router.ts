import { Router } from "express";
import bodyParser from "body-parser";
import authenticateApiRequestMiddleware from "../middleware/authenticateApiRequestMiddleware";
import usersRouter from "./users/users.router";
import groupsRouter from "./groups/groups.router";
import scimMiddleware from "./middleware/scimMiddleware";

const router = Router();

router.use(bodyParser.json({ limit: "1mb" }));
router.use(bodyParser.urlencoded({ limit: "1mb", extended: true }));

router.use(authenticateApiRequestMiddleware);
router.use(scimMiddleware);

// API endpoints
router.use("/users", usersRouter);
router.use("/groups", groupsRouter);

// 404 route
router.use(function (req, res) {
  res.status(404).json({
    message: "Unknown API endpoint",
  });
});

export default router;
