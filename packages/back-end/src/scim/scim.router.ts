import { Router } from "express";
import authenticateApiRequestMiddleware from "back-end/src/middleware/authenticateApiRequestMiddleware";
import usersRouter from "./users/users.router";
import groupsRouter from "./groups/groups.router";
import scimMiddleware from "./middleware/scimMiddleware";

const router = Router();

router.use(authenticateApiRequestMiddleware);
router.use(scimMiddleware);

// API endpoints
router.use("/users", usersRouter);
router.use("/groups", groupsRouter);

// 404 route
router.use(function (_req, res) {
  res.status(404).json({
    message: "Unknown API endpoint",
  });
});

export default router;
