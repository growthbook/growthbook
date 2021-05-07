/*
import {Response} from "express";
import {AuthRequest} from "../types/AuthRequest";
import {ReportInterface} from "../models/ReportModel";
import {getAllReportsByOrganization, createReport, getReportById, runReport} from "../services/reports";

export async function getReports(req: AuthRequest, res: Response) {
  const reports = await getAllReportsByOrganization(req.organization.id);

  res.status(200).json({
    status: 200,
    reports
  });
}

export async function getReport(req: AuthRequest, res: Response) {
  const {id}: {id: string} = req.params;

  const report = await getReportById(id);
  if (!report) {
    res.status(404).json({
      status: 404,
      message: "Report not found"
    });
    return;
  }

  if (report.organization !== req.organization.id) {
    res.status(401).json({
      status: 401,
      message: "You don't have access to view this report"
    });
    return;
  }

  try {
    const results = await runReport(id, true);
    res.status(200).json({
      status: 200,
      report,
      results,
    });
  }
  catch (e) {
    res.status(200).json({
      status: 200,
      report,
      results: [],
      error: e.message,
    });
  }
}

export async function postReports(req: AuthRequest, res: Response) {
  const report = await createReport(req.organization.id);

  res.status(200).json({
    status: 200,
    report: report.id
  });
}

export async function putReport(req: AuthRequest<ReportInterface>, res: Response) {
  const {id}: {id: string} = req.params;
  const data = req.body;

  const report = await getReportById(id);
  if (!report) {
    res.status(404).json({
      status: 404,
      message: "Report not found"
    });
    return;
  }

  if (report.organization !== req.organization.id) {
    res.status(401).json({
      status: 401,
      message: "You don't have access to view this report"
    });
    return;
  }

  const allowedKeys = ["title", "description", "queries"];
  allowedKeys.forEach((k: keyof ReportInterface) => {
    if (k in data && data[k] !== report[k]) {
      report.set(k, data[k]);
    }
  });

  await report.save();

  res.status(200).json({
    status: 200
  });
}
*/
