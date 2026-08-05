import type { Response } from "express";
import {
  AIModel,
  AIPromptInterface,
  AIPromptType,
  AIProvider,
  AI_PROVIDERS,
} from "shared/ai";
import { AICredentialFrontEndInterface } from "shared/validators";
import {
  getAISettingsForOrg,
  getContextFromReq,
} from "back-end/src/services/organizations";
import {
  clearResolvedAIKeysCache,
  encryptAIKey,
  getKeyLast4,
  verifyAIKey,
} from "back-end/src/services/aiCredentials";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import {
  secondsUntilAICanBeUsedAgainForPrompt,
  simpleCompletion,
} from "back-end/src/enterprise/services/ai";
import { getTokensUsedByOrganization } from "back-end/src/models/AITokenUsageModel";

type GetTokenUsageResponse = {
  status: 200;
  tokenUsage: {
    numTokensUsed: number;
    dailyLimit: number;
    nextResetAt: number;
  };
};

export async function getTokenUsage(
  req: AuthRequest,
  res: Response<GetTokenUsageResponse>,
) {
  const { org } = getContextFromReq(req);
  const tokenUsage = await getTokensUsedByOrganization(org);
  return res.status(200).json({
    status: 200,
    tokenUsage,
  });
}

type GetAICredentialsResponse = {
  status: 200;
  credentials: AICredentialFrontEndInterface[];
  // Providers that have a usable key from an environment variable. Lets the UI
  // say "inherited from ANTHROPIC_API_KEY" for a provider with no stored key,
  // and is org-scoped rather than read off the front-end server's own env.
  envProviders: AIProvider[];
};

export async function getAICredentials(
  req: AuthRequest,
  res: Response<GetAICredentialsResponse>,
) {
  const context = getContextFromReq(req);

  const [credentials, { keySource }] = await Promise.all([
    context.models.aiCredentials.getAllForFrontEnd(),
    getAISettingsForOrg(context),
  ]);

  return res.status(200).json({
    status: 200,
    credentials,
    envProviders: AI_PROVIDERS.filter((p) => keySource[p] === "env"),
  });
}

export async function putAICredential(
  req: AuthRequest<{ apiKey: string }, { provider: AIProvider }>,
  res: Response,
) {
  const context = getContextFromReq(req);
  const { provider } = req.params;

  // The model's own canCreate/canUpdate enforce this too; checking up front
  // means an unauthorized caller gets a clean 403 before we touch the provider.
  if (!context.permissions.canManageOrgSettings()) {
    context.permissions.throwPermissionError();
  }

  // Trim rather than reject on whitespace — a key pasted from a terminal or a
  // password manager very often carries a trailing newline.
  const apiKey = req.body.apiKey.trim();
  if (!apiKey) {
    return res.status(400).json({
      status: 400,
      message: "An API key is required",
    });
  }

  const { valid, message } = await verifyAIKey(provider, apiKey);
  if (!valid) {
    return res.status(400).json({
      status: 400,
      message,
    });
  }

  await context.models.aiCredentials.upsertForProvider(provider, {
    encryptedKey: encryptAIKey(apiKey),
    last4: getKeyLast4(apiKey),
    updatedByEmail: context.email,
  });

  // The resolver memoizes per request; drop it so anything later in this
  // request sees the key we just stored.
  clearResolvedAIKeysCache(context);

  return res.status(200).json({
    status: 200,
    // Present only when the key was saved without a successful verification.
    warning: message,
  });
}

export async function deleteAICredential(
  req: AuthRequest<null, { provider: AIProvider }>,
  res: Response,
) {
  const context = getContextFromReq(req);
  const { provider } = req.params;

  if (!context.permissions.canManageOrgSettings()) {
    context.permissions.throwPermissionError();
  }

  const deleted =
    await context.models.aiCredentials.deleteForProvider(provider);
  if (!deleted) {
    return res.status(404).json({
      status: 404,
      message: "No API key is stored for this provider",
    });
  }

  clearResolvedAIKeysCache(context);

  return res.status(200).json({
    status: 200,
  });
}

type GetAIPromptResponse = {
  status: 200;
  prompts: AIPromptInterface[];
};

export async function getAIPrompts(
  req: AuthRequest,
  res: Response<GetAIPromptResponse>,
) {
  const context = getContextFromReq(req);

  return res.status(200).json({
    status: 200,
    prompts: await context.models.aiPrompts.getAll(),
  });
}

export async function postAIPrompts(
  req: AuthRequest<{
    prompts: { type: AIPromptType; prompt: string; overrideModel?: AIModel }[];
  }>,
  res: Response,
) {
  const context = getContextFromReq(req);
  const { prompts } = req.body;

  const currentPrompts = await context.models.aiPrompts.getAll();

  await Promise.all(
    prompts.map(async ({ type, prompt, overrideModel }) => {
      const existingPrompt = currentPrompts.find((p) => p.type === type);
      if (existingPrompt) {
        return context.models.aiPrompts.update(existingPrompt, {
          prompt,
          overrideModel,
        });
      } else {
        return context.models.aiPrompts.create({
          type,
          prompt,
          overrideModel,
        });
      }
    }),
  );

  return res.status(200).json({
    status: 200,
  });
}

export async function postReformat(
  req: AuthRequest<{ type: AIPromptType; text: string; temperature?: number }>,
  res: Response,
) {
  const context = getContextFromReq(req);
  const { aiEnabled } = await getAISettingsForOrg(context);

  if (!aiEnabled) {
    return res.status(404).json({
      status: 404,
      message: "AI configuration not set or enabled",
    });
  }

  if (!req.organization) {
    return res.status(404).json({
      status: 404,
      message: "Organization not found",
    });
  }

  const secondsUntilReset = await secondsUntilAICanBeUsedAgainForPrompt(
    context,
    req.body.type,
  );
  if (secondsUntilReset > 0) {
    return res.status(429).json({
      status: 429,
      message: "Over AI usage limits",
      retryAfter: secondsUntilReset,
    });
  }

  const temperature = req.body.temperature ?? 0.1;
  const { prompt, isDefaultPrompt, overrideModel } =
    await context.models.aiPrompts.getAIPrompt(req.body.type);
  if (!prompt) {
    return res.status(400).json({
      status: 400,
      error: "Prompt not found",
    });
  }

  const { text } = req.body;
  const reformatPrompt = `Given the text: \n"${text}"\n\nReformat it according to the following format: ${prompt}`;
  const aiResults = await simpleCompletion({
    context,
    prompt: reformatPrompt,
    temperature,
    type: req.body.type,
    isDefaultPrompt,
    overrideModel,
  });

  res.status(200).json({
    status: 200,
    data: {
      output: aiResults,
    },
  });
}
