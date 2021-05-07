import request from "supertest";
import app from "../src/app";

describe("GET /random-url", () => {
  it("should return 401", (done) => {
    request(app).get("/random-url").expect(401, done);
  });
});

describe("POST /track", () => {
  // TODO: test valid and invalid track calls
});
