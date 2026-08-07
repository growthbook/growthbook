import type { Response } from "express";
import {
  AIModel,
  AIPromptInterface,
  AIPromptType,
  AIProvider,
  AI_PROVIDERS,
  AI_PROVIDER_META,
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
import { IS_CLOUD } from "back-end/src/util/secrets";

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

// ai-byok is Enterprise only, on Cloud and self-hosted alike.
const BYOK_PLAN_ERROR =
  "Using your own AI provider API key requires an Enterprise plan.";

type GetAICredentialsResponse = {
  status: 200;
  credentials: AICredentialFrontEndInterface[];
  // Providers with a usable env-var key, so the UI can say "inherited from
  // ANTHROPIC_API_KEY". Org-scoped, not the front-end server's own env.
  envProviders: AIProvider[];
  // The read itself isn't gated: no secrets here, and a downgraded org still
  // needs to see the rows it can remove.
  canUseOwnKeys: boolean;
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
    canUseOwnKeys: context.hasPremiumFeature("ai-byok"),
  });
}

export async function putAICredential(
  req: AuthRequest<{ apiKey: string }, { provider: AIProvider }>,
  res: Response,
) {
  const context = getContextFromReq(req);
  const { provider } = req.params;

  // The model enforces this too; up front means a clean 403 before we egress.
  if (!context.permissions.canManageOrgSettings()) {
    context.permissions.throwPermissionError();
  }

  // The model asserts this too; here it names the plan and runs before we send
  // the key to the provider to be verified.
  if (!context.hasPremiumFeature("ai-byok")) {
    context.throwPlanDoesNotAllowError(BYOK_PLAN_ERROR);
  }

  // Self-hosted, the env var always wins in the resolver, so this would store
  // dead data the UI implies is in use. Cloud is the opposite case: its env keys
  // are GrowthBook's managed ones, and overriding them is the whole point.
  if (!IS_CLOUD) {
    const { keySource } = await getAISettingsForOrg(context);
    if (keySource[provider] === "env") {
      return res.status(400).json({
        status: 400,
        message: `${AI_PROVIDER_META[provider].label} is configured by the ${AI_PROVIDER_META[provider].envVar} environment variable. Change it there instead.`,
      });
    }
  }

  // Trim rather than reject: pasted keys often carry a trailing newline.
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

  // The resolver memoizes per request; drop it so later reads see this write.
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
