import { GrowthBook } from "../../src";
import { getAttributes, NUM_ITERATIONS, payload } from "./common";

const FEATURES_TO_EVAL = Object.keys(payload.features);

console.log("Running...");
const start = Date.now();

for (let i = 0; i < NUM_ITERATIONS; i++) {
  // Separate GrowthBook instances
  const gb = new GrowthBook({
    attributes: getAttributes(i),
  }).initSync({
    payload,
  });

  FEATURES_TO_EVAL.forEach((feature) => {
    gb.isOn(feature);
  });

  gb.destroy();
}

const end = Date.now();
console.log("Total Time:", end - start, "ms");
console.log("Average Time:", (end - start) / NUM_ITERATIONS, "ms");
