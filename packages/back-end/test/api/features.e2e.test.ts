import "jest-expect-message";
import { z } from "zod";
import request from "supertest";
import { ReqContextClass } from "back-end/src/services/context";
import {
  postFeatureValidator,
  updateFeatureValidator,
} from "back-end/src/validators/openapi";
import { setupApp } from "./api.setup";

describe("api/features e2e tests", () => {
  const { app, setReqContext } = setupApp();

  beforeAll(async () => {
    setReqContext(
      new ReqContextClass({
        auditUser: null,
        role: "admin",
        org: {
          id: "my-org",
          name: "my-org",
          ownerEmail: "test@test.com",
          url: "https://test.com",
          dateCreated: new Date(),
          members: [],
          invites: [],
          settings: {},
        },
      })
    );
  });

  it("feature manipulation via api works", async () => {
    const createBody: z.infer<typeof postFeatureValidator.bodySchema> = {
      id: "my-special-feature",
      owner: "Guy",
      valueType: "boolean",
      defaultValue: "false",
      environments: {
        production: {
          enabled: true,
          rules: [
            {
              type: "force",
              value: "true",
              condition: '{"id": { "$in": ["forceRuleCondition"] } }',
            },
            {
              type: "experiment-ref",
              experimentId: "my-experiment",
              condition: '{"id": { "$in": ["experimentRefCondition"] } }',
              variations: [
                {
                  value: "false",
                  variationId: "1",
                },
                {
                  value: "true",
                  variationId: "2",
                },
              ],
            },
          ],
        },
      },
    };

    const createResponse = await request(app)
      .post("/api/v1/features")
      .send(createBody);

    expect(createResponse.status, "Feature creation failed").toBe(200);

    const getResponse = await request(app).get(
      `/api/v1/features/my-special-feature`
    );

    expect(getResponse.status, "Feature retrieval failed").toBe(200);
    expect(getResponse.body, "GET feature returned unexpected content").toEqual(
      expect.objectContaining({
        feature: expect.objectContaining({
          id: "my-special-feature",
          description: "",
          archived: false,
          dateCreated: expect.any(String),
          dateUpdated: expect.any(String),
          defaultValue: "false",
          environments: {
            dev: {
              enabled: false,
              defaultValue: "false",
              rules: [],
            },
            production: {
              enabled: true,
              defaultValue: "false",
              rules: [
                {
                  id: expect.any(String),
                  type: "force",
                  description: "",
                  value: "true",
                  condition: '{"id": { "$in": ["forceRuleCondition"] } }',
                  savedGroups: [],
                  enabled: true,
                  coverage: 1,
                  savedGroupTargeting: [],
                  prerequisites: [],
                },
                {
                  id: expect.any(String),
                  type: "experiment-ref",
                  enabled: true,
                  description: "",
                  experimentId: "my-experiment",
                  variations: [
                    {
                      variationId: "1",
                      value: "false",
                    },
                    {
                      variationId: "2",
                      value: "true",
                    },
                  ],
                  coverage: 1,
                  condition: '{"id": { "$in": ["experimentRefCondition"] } }',
                  savedGroupTargeting: [],
                  prerequisites: [],
                },
              ],
              definition: expect.any(String),
            },
          },
          prerequisites: [],
          owner: "Guy",
          project: "",
          tags: [],
          valueType: "boolean",
          revision: {
            comment: "",
            date: expect.any(String),
            publishedBy: "",
            version: 1,
          },
          customFields: {},
        }),
      })
    );

    const partialUpdateBody: z.infer<
      typeof updateFeatureValidator.bodySchema
    > = {
      environments: {
        production: {
          enabled: true,
          rules: [
            {
              ...getResponse.body.feature.environments.production.rules[0],
              condition: '{"id": { "$in": ["updatedForceRuleCondition"] } }',
            },
            {
              ...getResponse.body.feature.environments.production.rules[1],
              condition:
                '{"id": { "$in": ["updatedExperimentRefCondition"] } }',
            },
          ],
        },
      },
    };

    const partialUpdateResponse = await request(app)
      .post("/api/v1/features/my-special-feature")
      .send(partialUpdateBody);

    expect(partialUpdateResponse.status, "Partial update failed").toBe(200);
    expect(
      partialUpdateResponse.body,
      "Partial update did not work as expected"
    ).toEqual(
      expect.objectContaining({
        feature: expect.objectContaining({
          id: "my-special-feature",
          description: "",
          archived: false,
          dateCreated: expect.any(String),
          dateUpdated: expect.any(String),
          defaultValue: "false",
          environments: {
            dev: {
              enabled: false,
              defaultValue: "false",
              rules: [],
            },
            production: {
              enabled: true,
              defaultValue: "false",
              rules: [
                {
                  id: expect.any(String),
                  type: "force",
                  description: "",
                  value: "true",
                  condition:
                    '{"id": { "$in": ["updatedForceRuleCondition"] } }',
                  savedGroups: [],
                  enabled: true,
                  coverage: 1,
                  savedGroupTargeting: [],
                  prerequisites: [],
                },
                {
                  id: expect.any(String),
                  type: "experiment-ref",
                  enabled: true,
                  description: "",
                  experimentId: "my-experiment",
                  variations: [
                    {
                      variationId: "1",
                      value: "false",
                    },
                    {
                      variationId: "2",
                      value: "true",
                    },
                  ],
                  coverage: 1,
                  condition:
                    '{"id": { "$in": ["updatedExperimentRefCondition"] } }',
                  savedGroupTargeting: [],
                  prerequisites: [],
                },
              ],
              definition: expect.any(String),
            },
          },
          prerequisites: [],
          owner: "Guy",
          project: "",
          tags: [],
          valueType: "boolean",
          revision: {
            comment: "Created via REST API",
            date: expect.any(String),
            publishedBy: "",
            version: 2,
          },
          customFields: {},
        }),
      })
    );
  });
});
