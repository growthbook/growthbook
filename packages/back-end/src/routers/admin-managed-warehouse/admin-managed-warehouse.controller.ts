import type { Response } from "express";
import { hasSuperAdminPermission } from "shared/permissions";
import type { ManagedWarehouseRecreatableTable } from "shared/util";
import type { AuthRequest } from "back-end/src/types/AuthRequest";
import {
  cancelPendingManagedWarehouseRecreates,
  getManagedWarehouseRecreateRequest,
  getManagedWarehouseRecreateSummary,
  requestManagedWarehouseRecreates,
  retryFailedManagedWarehouseRecreates,
} from "back-end/src/services/managedWarehouseRecreate";

function forbidden(res: Response, permission: "view" | "provision") {
  return res.status(403).json({
    status: 403,
    message: `This action requires the ${permission} super admin permission`,
  });
}

export async function getRecreates(req: AuthRequest, res: Response) {
  if (!hasSuperAdminPermission(req.superAdmin, "view")) {
    return forbidden(res, "view");
  }
  res.status(200).json({
    status: 200,
    ...(await getManagedWarehouseRecreateSummary()),
  });
}

export async function getOrganizationRecreate(
  req: AuthRequest<null, { orgId: string }>,
  res: Response,
) {
  if (!hasSuperAdminPermission(req.superAdmin, "view")) {
    return forbidden(res, "view");
  }
  res.status(200).json({
    status: 200,
    request: await getManagedWarehouseRecreateRequest(req.params.orgId),
  });
}

export async function postRecreates(
  req: AuthRequest<{
    tables: ManagedWarehouseRecreatableTable[];
    organizations: string[] | "all";
  }>,
  res: Response,
) {
  if (!hasSuperAdminPermission(req.superAdmin, "provision")) {
    return forbidden(res, "provision");
  }
  const created = await requestManagedWarehouseRecreates({
    organizations: req.body.organizations,
    tables: req.body.tables,
    requestedBy: req.userId ?? "",
  });
  res.status(200).json({ status: 200, created });
}

export async function postRetryFailedRecreates(
  req: AuthRequest,
  res: Response,
) {
  if (!hasSuperAdminPermission(req.superAdmin, "provision")) {
    return forbidden(res, "provision");
  }
  const retried = await retryFailedManagedWarehouseRecreates(req.userId ?? "");
  res.status(200).json({ status: 200, retried });
}

export async function postCancelPendingRecreates(
  req: AuthRequest,
  res: Response,
) {
  if (!hasSuperAdminPermission(req.superAdmin, "provision")) {
    return forbidden(res, "provision");
  }
  const cancelled = await cancelPendingManagedWarehouseRecreates();
  res.status(200).json({ status: 200, cancelled });
}
