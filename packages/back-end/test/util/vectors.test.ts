import { getEmbeddingsForModel } from "back-end/src/util/vectors";

describe("getEmbeddingsForModel", () => {
  it("keeps only vectors from the requested model", () => {
    const result = getEmbeddingsForModel(
      [
        { joinId: "a", model: "text-embedding-3-small", embeddings: [1, 2] },
        { joinId: "b", model: "text-embedding-ada-002", embeddings: [3, 4] },
        { joinId: "c", model: "text-embedding-3-small", embeddings: [5, 6] },
      ],
      "text-embedding-3-small",
    );
    expect(Array.from(result.entries())).toEqual([
      ["a", [1, 2]],
      ["c", [5, 6]],
    ]);
  });

  it("treats vectors without a model as stale", () => {
    const result = getEmbeddingsForModel(
      [{ joinId: "a", embeddings: [1, 2] }],
      "text-embedding-ada-002",
    );
    expect(result.size).toBe(0);
  });

  it("skips vectors with empty embeddings", () => {
    const result = getEmbeddingsForModel(
      [{ joinId: "a", model: "text-embedding-ada-002", embeddings: [] }],
      "text-embedding-ada-002",
    );
    expect(result.size).toBe(0);
  });
});
