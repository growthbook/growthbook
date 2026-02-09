import { Router } from "express";
import authenticateApiRequestMiddleware from "back-end/src/middleware/authenticateApiRequestMiddleware";
import usersRouter from "./users/users.router";
import groupsRouter from "./groups/groups.router";
import scimMiddleware from "./middleware/scimMiddleware";
import { getServiceProviderConfig } from "./serviceProviderConfig";
import { getSchemas } from "./schemas";

const router = Router();

router.use(authenticateApiRequestMiddleware);
router.use(scimMiddleware);

// API endpoints
router.use("/users", usersRouter);
router.use("/groups", groupsRouter);

// Discovery endpoints
router.get("/ServiceProviderConfig", getServiceProviderConfig);
router.get("/Schemas", getSchemas);

// Return a 200 response for root endpoint
router.get("/", (_req, res) => {
  res.status(200).json({
    schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
    totalResults: 0,
    Resources: [],
  });
});

// Return a 404 response for all other endpoints
router.use((_req, res) => {
  res.status(404).json({
    schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
    status: "404",
    detail: "Unknown API endpoint",
  });
});

export default router;
