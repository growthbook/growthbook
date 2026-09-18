import mongoose from "mongoose";
import { parseOpenRouterModelRows, type OpenRouterModel } from "shared/ai";
import type { OpenRouterCatalogSnapshot } from "back-end/src/services/openRouterModelCatalog";

const CATALOG_ID = "openrouter-models";

type AIPriceCatalogInterface = {
  id: string;
  fetchedAt: number;
  models: OpenRouterModel[];
};

type AIPriceCatalogDocument = mongoose.Document & AIPriceCatalogInterface;

const aiPriceCatalogSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  fetchedAt: { type: Number, required: true },
  models: { type: [mongoose.Schema.Types.Mixed], default: [] },
});

const AIPriceCatalogModel = mongoose.model<AIPriceCatalogDocument>(
  "AIPriceCatalog",
  aiPriceCatalogSchema,
);

export async function loadOpenRouterCatalogSnapshot(): Promise<OpenRouterCatalogSnapshot | null> {
  const doc = await AIPriceCatalogModel.findOne({ id: CATALOG_ID }).lean();
  if (!doc || typeof doc.fetchedAt !== "number") return null;
  const models = parseOpenRouterModelRows(doc.models);
  if (models.length === 0) return null;
  return { fetchedAt: doc.fetchedAt, models };
}

export async function saveOpenRouterCatalogSnapshot(
  snapshot: OpenRouterCatalogSnapshot,
): Promise<void> {
  await AIPriceCatalogModel.updateOne(
    { id: CATALOG_ID },
    {
      $set: {
        fetchedAt: snapshot.fetchedAt,
        models: snapshot.models,
      },
      $setOnInsert: { id: CATALOG_ID },
    },
    { upsert: true },
  );
}
