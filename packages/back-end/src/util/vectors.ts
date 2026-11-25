import { Vectors } from "back-end/src/validators/vectors";

// Cosine similarity across embedding models is meaningless, so legacy vectors without a model are treated as stale
export function getEmbeddingsForModel(
  vectors: Pick<Vectors, "joinId" | "model" | "embeddings">[],
  model: string,
): Map<string, number[]> {
  return new Map(
    vectors
      .filter((v) => v.model === model && v.embeddings.length > 0)
      .map((v) => [v.joinId, v.embeddings]),
  );
}
