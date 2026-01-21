#!/usr/bin/env node
/**
 * Test script to verify all AI models work with a simple query and structured output
 * Usage: npx ts-node test-models.ts
 */

import * as dotenv from "dotenv";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createXai } from "@ai-sdk/xai";
import { createMistral } from "@ai-sdk/mistral";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateText, Output } from "ai";
import { z } from "zod";
import {
  AI_PROVIDER_MODEL_MAP,
  getProviderFromModel,
  AIProvider,
} from "shared/ai";
// eslint-disable-next-line no-restricted-imports
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

// Simple schema for testing structured output
const testSchema = z.object({
  greeting: z.string().describe("A simple greeting message"),
});

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

async function testModel(model: string): Promise<{
  textSuccess: boolean;
  textError?: string;
  structuredSuccess: boolean;
  structuredError?: string;
}> {
  const provider = getProviderFromModel(model as never);

  // Check if API key is available
  if (!apiKeys[provider]) {
    return {
      textSuccess: false,
      textError: `No API key for ${provider}`,
      structuredSuccess: false,
      structuredError: `No API key for ${provider}`,
    };
  }

  const aiProvider = getProviderInstance(provider);

  // Test 1: Regular text generation
  let textSuccess = false;
  let textError: string | undefined;
  try {
    await generateText({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      model: aiProvider(model) as any,
      prompt: "Say hello",
    });
    textSuccess = true;
  } catch (error) {
    textError = error instanceof Error ? error.message : String(error);
  }

  // Test 2: Structured output (like parsePrompt)
  let structuredSuccess = false;
  let structuredError: string | undefined;
  try {
    await generateText({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      model: aiProvider(model) as any,
      prompt: "Say hello",
      output: Output.object({
        schema: testSchema,
      }),
    });
    structuredSuccess = true;
  } catch (error) {
    structuredError = error instanceof Error ? error.message : String(error);
  }

  return { textSuccess, textError, structuredSuccess, structuredError };
}

async function main() {
  logger.info("Testing AI models (text + structured output)...\n");

  const results: Record<
    string,
    {
      total: number;
      passed: number;
      failed: number;
      skipped: number;
      structuredPassed: number;
      structuredFailed: number;
      errors: string[];
      modelsToRemove: string[];
    }
  > = {};

  for (const [providerKey, models] of Object.entries(AI_PROVIDER_MODEL_MAP)) {
    const provider = providerKey as AIProvider;
    results[provider] = {
      total: models.length,
      passed: 0,
      failed: 0,
      skipped: 0,
      structuredPassed: 0,
      structuredFailed: 0,
      errors: [],
      modelsToRemove: [],
    };

    logger.info(`\n${provider.toUpperCase()} (${models.length} models):`);
    logger.info("=".repeat(60));

    for (const model of models) {
      const result = await testModel(model);

      if (result.textError?.includes("No API key")) {
        results[provider].skipped++;
        logger.info(`⊘ ${model} - ${result.textError}`);
      } else if (result.textSuccess) {
        results[provider].passed++;
        if (result.structuredSuccess) {
          results[provider].structuredPassed++;
          logger.info(`✓ ${model} (text + structured)`);
        } else {
          results[provider].structuredFailed++;
          results[provider].modelsToRemove.push(model);
          logger.info(`⚠ ${model} (text only, NO structured output)`);
          if (result.structuredError) {
            results[provider].errors.push(
              `${model} (structured): ${result.structuredError}`,
            );
          }
        }
      } else {
        results[provider].failed++;
        results[provider].modelsToRemove.push(model);
        logger.info(`✗ ${model} - ${result.textError}`);
        if (result.textError) {
          results[provider].errors.push(`${model}: ${result.textError}`);
        }
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
  let totalStructuredPassed = 0;
  let totalStructuredFailed = 0;

  for (const [provider, stats] of Object.entries(results)) {
    logger.info(`\n${provider.toUpperCase()}:`);
    logger.info(`  Total:              ${stats.total}`);
    logger.info(`  Text Generation:    ${stats.passed}/${stats.total} ✓`);
    logger.info(
      `  Structured Output:  ${stats.structuredPassed}/${stats.total} ✓`,
    );
    logger.info(`  Failed:             ${stats.failed}/${stats.total}`);
    logger.info(`  Skipped:            ${stats.skipped}/${stats.total}`);

    if (stats.modelsToRemove.length > 0) {
      logger.info(`  Models to Remove (${stats.modelsToRemove.length}):`);
      stats.modelsToRemove.forEach((model) => logger.info(`    - ${model}`));
    }

    if (stats.errors.length > 0) {
      logger.info(`  Errors:`);
      stats.errors.forEach((error) => logger.info(`    - ${error}`));
    }

    totalPassed += stats.passed;
    totalFailed += stats.failed;
    totalSkipped += stats.skipped;
    totalStructuredPassed += stats.structuredPassed;
    totalStructuredFailed += stats.structuredFailed;
  }

  logger.info("\n" + "=".repeat(60));
  logger.info(
    `OVERALL: ${totalPassed} text, ${totalStructuredPassed} structured, ${totalFailed} failed, ${totalSkipped} skipped`,
  );

  if (totalStructuredFailed > 0) {
    logger.info(
      `\n⚠️  ${totalStructuredFailed} models do not support structured output and should be removed!`,
    );
  }

  if (totalFailed > 0 || totalStructuredFailed > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  logger.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
