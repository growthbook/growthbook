import { Response } from "express";
import { RampScheduleTemplateInterface } from "shared/validators";
import { UpdateProps } from "shared/types/base-model";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { getContextFromReq } from "back-end/src/services/organizations";

// GET /ramp-schedule-templates
export const getRampScheduleTemplates = async (
  req: AuthRequest,
  res: Response,
) => {
  const context = getContextFromReq(req);
  const templates = await context.models.rampScheduleTemplates.getAll();
  res.status(200).json({ status: 200, rampScheduleTemplates: templates });
};

// GET /ramp-schedule-templates/:id
export const getRampScheduleTemplate = async (
  req: AuthRequest<null, { id: string }>,
  res: Response,
) => {
  const context = getContextFromReq(req);
  const template = await context.models.rampScheduleTemplates.getById(
    req.params.id,
  );
  if (!template) {
    return res.status(404).json({ status: 404, message: "Template not found" });
  }
  res.status(200).json({ status: 200, rampScheduleTemplate: template });
};

// POST /ramp-schedule-templates
export const postRampScheduleTemplate = async (
  req: AuthRequest<
    Omit<
      RampScheduleTemplateInterface,
      "id" | "organization" | "dateCreated" | "dateUpdated"
    >
  >,
  res: Response,
) => {
  const context = getContextFromReq(req);

  if (!context.hasPremiumFeature("ramp-schedules")) {
    context.throwPlanDoesNotAllowError(
      "Ramp schedule templates require an Enterprise plan.",
    );
  }

  const body = req.body;

  const { steps, name, official, endPatch } = body;

  const created = await context.models.rampScheduleTemplates.create({
    name,
    steps: steps ?? [],
    endPatch,
    official,
  });
  res.status(201).json({ status: 201, rampScheduleTemplate: created });
};

// PUT /ramp-schedule-templates/:id
export const putRampScheduleTemplate = async (
  req: AuthRequest<Partial<RampScheduleTemplateInterface>, { id: string }>,
  res: Response,
) => {
  const context = getContextFromReq(req);

  if (!context.hasPremiumFeature("ramp-schedules")) {
    context.throwPlanDoesNotAllowError(
      "Ramp schedule templates require an Enterprise plan.",
    );
  }

  const template = await context.models.rampScheduleTemplates.getById(
    req.params.id,
  );
  if (!template) {
    return res.status(404).json({ status: 404, message: "Template not found" });
  }

  const body = req.body;
  const updates: UpdateProps<RampScheduleTemplateInterface> = {};
  if (body.name !== undefined) updates.name = body.name;
  if (body.steps !== undefined) updates.steps = body.steps;
  if (body.endPatch !== undefined) updates.endPatch = body.endPatch;
  if (body.official !== undefined) updates.official = body.official;

  const updated = await context.models.rampScheduleTemplates.updateById(
    template.id,
    updates,
  );
  res.status(200).json({ status: 200, rampScheduleTemplate: updated });
};

// DELETE /ramp-schedule-templates/:id
export const deleteRampScheduleTemplate = async (
  req: AuthRequest<null, { id: string }>,
  res: Response,
) => {
  const context = getContextFromReq(req);
  const template = await context.models.rampScheduleTemplates.getById(
    req.params.id,
  );
  if (!template) {
    return res.status(404).json({ status: 404, message: "Template not found" });
  }
  await context.models.rampScheduleTemplates.deleteById(template.id);
  res.status(200).json({ status: 200 });
};
