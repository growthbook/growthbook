import { Router } from "express";
import authenticateApiRequestMiddleware from "../middleware/authenticateApiRequestMiddleware";
import usersRouter from "./users/users.router";
import scimMiddleware from "./middleware/scimMiddleware";
import groupsRouter from "./groups/groups.router";

const router = Router();

router.use(authenticateApiRequestMiddleware);
router.use(scimMiddleware); // TODO: Comment out for testing

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
