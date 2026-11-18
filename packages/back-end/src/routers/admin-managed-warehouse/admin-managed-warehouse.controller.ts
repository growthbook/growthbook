import type { Response } from "express";
import { hasSuperAdminPermission } from "shared/permissions";
import type { ManagedWarehouseRecreatableTable } from "shared/util";
import type { AuthRequest } from "back-end/src/types/AuthRequest";
import {
  cancelPendingManagedWarehouseRecreates,
  deleteManagedWarehouseRecreateRequest,
  getManagedWarehouseRecreateSummary,
  requestManagedWarehouseRecreates,
  retryFailedManagedWarehouseRecreates,
} from "back-end/src/services/managedWarehouseRecreate";
import { startManagedWarehouseRecreates } from "back-end/src/jobs/recreateManagedWarehouseTables";

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
  // Start the first batch now rather than on the next sweep
  await startManagedWarehouseRecreates();
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
  await startManagedWarehouseRecreates();
  res.status(200).json({ status: 200, retried });
}

export async function deleteRecreate(
  req: AuthRequest<null, { orgId: string }>,
  res: Response,
) {
  if (!hasSuperAdminPermission(req.superAdmin, "provision")) {
    return forbidden(res, "provision");
  }
  if (!(await deleteManagedWarehouseRecreateRequest(req.params.orgId))) {
    return res.status(409).json({
      status: 409,
      message:
        "This recreate is running and can't be stopped, or it no longer exists.",
    });
  }
  res.status(200).json({ status: 200 });
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
