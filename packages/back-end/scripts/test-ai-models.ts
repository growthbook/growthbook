#!/usr/bin/env node
/**
 * Test script to verify all AI models work with a simple query
 * Usage: npx ts-node test-models.ts
 */

import * as dotenv from "dotenv";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createXai } from "@ai-sdk/xai";
import { createMistral } from "@ai-sdk/mistral";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateText } from "ai";
import {
  AI_PROVIDER_MODEL_MAP,
  getProviderFromModel,
  AIProvider,
} from "shared/ai";
import { logger } from "../src/util/logger";

// Load environment variables from .env.local
dotenv.config({ path: ".env.local" });

// Load environment variables
const apiKeys: Record<AIProvider, string | undefined> = {
  openai: process.env.OPENAI_API_KEY,
  anthropic: process.env.ANTHROPIC_API_KEY,
  xai: process.env.XAI_API_KEY,
  mistral: process.env.MISTRAL_API_KEY,
  google: process.env.GOOGLE_AI_API_KEY,
};

function getProviderInstance(provider: AIProvider) {
  switch (provider) {
    case "openai":
      return createOpenAI({ apiKey: apiKeys.openai });
    case "anthropic":
      return createAnthropic({ apiKey: apiKeys.anthropic });
    case "xai":
      return createXai({ apiKey: apiKeys.xai });
    case "mistral":
      return createMistral({ apiKey: apiKeys.mistral });
    case "google":
      return createGoogleGenerativeAI({ apiKey: apiKeys.google });
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

async function testModel(
  model: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const provider = getProviderFromModel(model);

    // Check if API key is available
    if (!apiKeys[provider]) {
      return {
        success: false,
        error: `No API key for ${provider}`,
      };
    }

    const aiProvider = getProviderInstance(provider);

    // Try a very simple generation
    await generateText({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      model: aiProvider(model) as any,
      prompt: "Say hello",
    });

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function main() {
  logger.info("Testing AI models...\n");

  const results: Record<
    string,
    {
      total: number;
      passed: number;
      failed: number;
      skipped: number;
      errors: string[];
    }
  > = {};

  for (const [providerKey, models] of Object.entries(AI_PROVIDER_MODEL_MAP)) {
    const provider = providerKey as AIProvider;
    results[provider] = {
      total: models.length,
      passed: 0,
      failed: 0,
      skipped: 0,
      errors: [],
    };

    logger.info(`\n${provider.toUpperCase()} (${models.length} models):`);
    logger.info("=".repeat(60));

    for (const model of models) {
      const result = await testModel(model);

      if (result.success) {
        results[provider].passed++;
        logger.info(`✓ ${model}`);
      } else if (result.error?.includes("No API key")) {
        results[provider].skipped++;
        logger.info(`⊘ ${model} - ${result.error}`);
      } else {
        results[provider].failed++;
        results[provider].errors.push(`${model}: ${result.error}`);
        logger.info(`✗ ${model} - ${result.error}`);
      }

      // Small delay to avoid rate limits
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  // Summary
  logger.info("\n\nSUMMARY:");
  logger.info("=".repeat(60));
  let totalPassed = 0;
  let totalFailed = 0;
  let totalSkipped = 0;

  for (const [provider, stats] of Object.entries(results)) {
    logger.info(`\n${provider.toUpperCase()}:`);
    logger.info(`  Passed:  ${stats.passed}/${stats.total}`);
    logger.info(`  Failed:  ${stats.failed}/${stats.total}`);
    logger.info(`  Skipped: ${stats.skipped}/${stats.total}`);

    if (stats.errors.length > 0) {
      logger.info(`  Errors:`);
      stats.errors.forEach((error) => logger.info(`    - ${error}`));
    }

    totalPassed += stats.passed;
    totalFailed += stats.failed;
    totalSkipped += stats.skipped;
  }

  logger.info(
    `\nOVERALL: ${totalPassed} passed, ${totalFailed} failed, ${totalSkipped} skipped`,
  );

  if (totalFailed > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  logger.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
