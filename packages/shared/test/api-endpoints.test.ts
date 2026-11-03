import * as endpointModules from "../src/api-endpoints";

describe("api-endpoints", () => {
  it.each(Object.entries(endpointModules))(
    "%s exports are named after their operationId",
    (_, endpoints) => {
      for (const [name, endpoint] of Object.entries(endpoints)) {
        expect(endpoint.operationId).toBe(name);
      }
    },
  );
});
