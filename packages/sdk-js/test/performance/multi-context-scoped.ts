import { GrowthBookClient } from "../../src";
import { getAttributes, NUM_ITERATIONS, payload } from "./common";

const FEATURES_TO_EVAL = Object.keys(payload.features);

console.log("Running...");
const start = Date.now();

// Singleton instance
const globalGB = new GrowthBookClient().initSync({
  payload,
});

for (let i = 0; i < NUM_ITERATIONS; i++) {
  // Scoped instance
  const gb = globalGB.createScopedInstance({
    attributes: getAttributes(i),
  });
  FEATURES_TO_EVAL.forEach((feature) => {
    gb.isOn(feature);
  });
}

globalGB.destroy();

const end = Date.now();
console.log("Total Time:", end - start, "ms");
console.log("Average Time:", (end - start) / NUM_ITERATIONS, "ms");
