import { Request, Response } from "express";
import { getOrganizationFromSlackTeam } from "../models/OrganizationModel";
import { createIdea } from "../services/ideas";
import { formatTextResponse, getUserInfoBySlackId } from "../services/slack";
import { APP_ORIGIN } from "../util/secrets";

export async function postIdeas(req: Request, res: Response) {
  try {
    const organization = await getOrganizationFromSlackTeam(req.body.team_id);

    const { id, name } = await getUserInfoBySlackId(
      req.body.user_id,
      organization,
    );

    const text: string = req.body.text;

    if (text.length < 3) {
      throw new Error(
        "Idea cannot be empty. Example usage: `/idea this is my cool idea`",
      );
    }

    const idea = await createIdea({
      text,
      source: "slack",
      details: "",
      userId: id,
      userName: name || req.body.user_name,
      organization: organization.id,
      tags: [],
      votes: [],
    });

    res.json(
      formatTextResponse(`Idea created! <${APP_ORIGIN}/idea/${idea.id}>`),
    );
  } catch (e) {
    res.json(formatTextResponse(`*Error:* ${e.message}`));
  }
}
