import type { Response } from "express";
import { AuthRequest } from "../../types/AuthRequest";
import { getOrgFromReq } from "../../services/organizations";
import {
  CreateFactFilterProps,
  CreateFactProps,
  CreateFactTableProps,
  FactTableInterface,
  UpdateFactFilterProps,
  UpdateFactProps,
  UpdateFactTableProps,
} from "../../../types/fact-table";
import {
  createFact,
  createFactTable,
  getAllFactTablesForOrganization,
  getFactTable,
  updateFact,
  updateFactTable,
  deleteFactTable as deleteFactTableInDb,
  deleteFact as deleteFactInDb,
  deleteFactFilter as deleteFactFilterInDb,
  createFactFilter,
  updateFactFilter,
} from "../../models/FactTableModel";

export const getFactTables = async (
  req: AuthRequest,
  res: Response<{ status: 200; factTables: FactTableInterface[] }>
) => {
  const { org } = getOrgFromReq(req);

  const factTables = await getAllFactTablesForOrganization(org.id);

  res.status(200).json({
    status: 200,
    factTables,
  });
};

export const postFactTable = async (
  req: AuthRequest<CreateFactTableProps>,
  res: Response<{ status: 200; factTable: FactTableInterface }>
) => {
  const data = req.body;
  const { org } = getOrgFromReq(req);

  req.checkPermissions("manageFactTables", data.projects || "");

  const factTable = await createFactTable(org.id, data);

  res.status(200).json({
    status: 200,
    factTable,
  });
};

export const putFactTable = async (
  req: AuthRequest<UpdateFactTableProps, { id: string }>,
  res: Response<{ status: 200 }>
) => {
  const data = req.body;
  const { org } = getOrgFromReq(req);

  const factTable = await getFactTable(org.id, req.params.id);
  if (!factTable) {
    throw new Error("Could not find fact table with that id");
  }

  req.checkPermissions("manageFactTables", factTable.projects);
  if (data.projects) {
    req.checkPermissions("manageFactTables", data.projects || "");
  }

  await updateFactTable(factTable, data);

  res.status(200).json({
    status: 200,
  });
};

export const deleteFactTable = async (
  req: AuthRequest<null, { id: string }>,
  res: Response<{ status: 200 }>
) => {
  const { org } = getOrgFromReq(req);

  const factTable = await getFactTable(org.id, req.params.id);
  if (!factTable) {
    throw new Error("Could not find fact table with that id");
  }
  req.checkPermissions("manageFactTables", factTable.projects);

  await deleteFactTableInDb(factTable);

  res.status(200).json({
    status: 200,
  });
};

export const postFact = async (
  req: AuthRequest<CreateFactProps, { id: string }>,
  res: Response<{ status: 200; factId: string }>
) => {
  const data = req.body;
  const { org } = getOrgFromReq(req);

  const factTable = await getFactTable(org.id, req.params.id);
  if (!factTable) {
    throw new Error("Could not find fact table with that id");
  }

  req.checkPermissions("manageFactTables", factTable.projects);

  const fact = await createFact(factTable, data);

  res.status(200).json({
    status: 200,
    factId: fact.id,
  });
};

export const putFact = async (
  req: AuthRequest<UpdateFactProps, { id: string; factId: string }>,
  res: Response<{ status: 200 }>
) => {
  const data = req.body;
  const { org } = getOrgFromReq(req);

  const factTable = await getFactTable(org.id, req.params.id);
  if (!factTable) {
    throw new Error("Could not find fact table with that id");
  }

  req.checkPermissions("manageFactTables", factTable.projects);

  await updateFact(factTable, req.params.factId, data);

  res.status(200).json({
    status: 200,
  });
};

export const deleteFact = async (
  req: AuthRequest<null, { id: string; factId: string }>,
  res: Response<{ status: 200 }>
) => {
  const { org } = getOrgFromReq(req);

  const factTable = await getFactTable(org.id, req.params.id);
  if (!factTable) {
    throw new Error("Could not find fact table with that id");
  }
  req.checkPermissions("manageFactTables", factTable.projects);

  await deleteFactInDb(factTable, req.params.factId);

  res.status(200).json({
    status: 200,
  });
};

export const postFactFilter = async (
  req: AuthRequest<CreateFactFilterProps, { id: string }>,
  res: Response<{ status: 200; filterId: string }>
) => {
  const data = req.body;
  const { org } = getOrgFromReq(req);

  const factTable = await getFactTable(org.id, req.params.id);
  if (!factTable) {
    throw new Error("Could not find fact table with that id");
  }

  req.checkPermissions("manageFactTables", factTable.projects);

  const filter = await createFactFilter(factTable, data);

  res.status(200).json({
    status: 200,
    filterId: filter.id,
  });
};

export const putFactFilter = async (
  req: AuthRequest<UpdateFactFilterProps, { id: string; filterId: string }>,
  res: Response<{ status: 200 }>
) => {
  const data = req.body;
  const { org } = getOrgFromReq(req);

  const factTable = await getFactTable(org.id, req.params.id);
  if (!factTable) {
    throw new Error("Could not find fact table with that id");
  }

  req.checkPermissions("manageFactTables", factTable.projects);

  await updateFactFilter(factTable, req.params.filterId, data);

  res.status(200).json({
    status: 200,
  });
};

export const deleteFactFilter = async (
  req: AuthRequest<null, { id: string; filterId: string }>,
  res: Response<{ status: 200 }>
) => {
  const { org } = getOrgFromReq(req);

  const factTable = await getFactTable(org.id, req.params.id);
  if (!factTable) {
    throw new Error("Could not find filter table with that id");
  }
  req.checkPermissions("manageFactTables", factTable.projects);

  await deleteFactFilterInDb(factTable, req.params.filterId);

  res.status(200).json({
    status: 200,
  });
};
