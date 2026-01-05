#!/usr/bin/env node
/**
 * List available Google Gemini models
 * Usage: npx ts-node list-google-models.ts
 */

import * as dotenv from "dotenv";
import { logger } from "../src/util/logger";

// Load environment variables from .env.local
dotenv.config({ path: ".env.local" });

interface GoogleModel {
  name: string;
  displayName: string;
  description: string;
  supportedGenerationMethods?: string[];
}

interface GoogleModelsResponse {
  models?: GoogleModel[];
}

async function listGoogleModels() {
  const apiKey = process.env.GOOGLE_AI_API_KEY;

  if (!apiKey) {
    logger.error("GOOGLE_AI_API_KEY not found in .env.local");
    process.exit(1);
  }

  logger.info("Fetching available Google Gemini models...\n");

  try {
    // Use the Google Generative AI REST API to list models
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
    );

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = (await response.json()) as GoogleModelsResponse;

    logger.info(`Found ${data.models?.length || 0} models:\n`);

    if (data.models) {
      // Filter for generative models (not embedding/vision only)
      const textModels = data.models.filter((model) =>
        model.supportedGenerationMethods?.includes("generateContent"),
      );

      logger.info("Text Generation Models:");
      logger.info("=".repeat(60));
      textModels.forEach((model) => {
        const name = model.name.replace("models/", "");
        logger.info(`  ${name}`);
        logger.info(`    Display Name: ${model.displayName}`);
        logger.info(`    Description: ${model.description}`);
        logger.info(
          `    Supported Methods: ${model.supportedGenerationMethods?.join(", ")}`,
        );
        logger.info("");
      });

      logger.info("\nModel IDs for shared/ai.ts:");
      logger.info("=".repeat(60));
      textModels.forEach((model) => {
        const name = model.name.replace("models/", "");
        logger.info(`  "${name}",`);
      });
    }
  } catch (error) {
    logger.error(
      "Error fetching models:",
      error instanceof Error ? error.message : String(error),
    );
    process.exit(1);
  }
}

listGoogleModels();
