import request from "supertest";
import app from "../src/app";

describe("api", () => {
  it("should return 401 when hitting non-existing endpoint", (done) => {
    request(app).get("/random-url").expect(401, done);
  });
});
