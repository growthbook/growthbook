import cloneDeep from "lodash/cloneDeep";
import { evaluatePrerequisiteState } from "shared/util";
import { FeatureInterface } from "shared/types/feature";
import { generateFeaturesPayload } from "back-end/src/services/features";

describe("Prerequisite reduction in SDK Payload", () => {
  const childFeature: FeatureInterface = {
    id: "child1",
    dateCreated: new Date(),
    dateUpdated: new Date(),
    valueType: "boolean" as const,
    defaultValue: "true",
    organization: "123",
    project: "",
    owner: "",
    version: 1,
    prerequisites: [
      {
        id: "parent1",
        condition: `{"value": true}`,
      },
    ],
    environmentSettings: {
      production: {
        enabled: true,
        rules: [],
      },
    },
  };
  const parentFeature: FeatureInterface = {
    id: "parent1",
    dateCreated: new Date(),
    dateUpdated: new Date(),
    valueType: "boolean" as const,
    defaultValue: "true",
    organization: "123",
    project: "",
    owner: "",
    version: 1,
    environmentSettings: {
      production: {
        enabled: true,
        rules: [],
      },
    },
  };

  it("Does not block when top-level prerequisite is live", () => {
    const features: FeatureInterface[] = [
      cloneDeep(childFeature),
      cloneDeep(parentFeature),
    ];
    const payload = generateFeaturesPayload({
      features: features,
      environment: "production",
      groupMap: new Map(),
      experimentMap: new Map(),
    });
    expect(payload).toHaveProperty("parent1");
    expect(payload).toHaveProperty("child1");
    // Prereq rules should be stripped from the child because parent is unambiguously "on"
    expect(payload.child1).not.toHaveProperty("rules");
  });

  it("Blocks when top-level prerequisite is live but serving false", () => {
    const features: FeatureInterface[] = [
      cloneDeep(childFeature),
      {
        ...cloneDeep(parentFeature),
        ...{
          defaultValue: "false",
        },
      },
    ];
    const payload = generateFeaturesPayload({
      features: features,
      environment: "production",
      groupMap: new Map(),
      experimentMap: new Map(),
    });
    expect(payload).toHaveProperty("parent1");
    expect(payload).not.toHaveProperty("child1");
  });

  it("Blocks when top-level prerequisite is toggled off", () => {
    const features: FeatureInterface[] = [
      cloneDeep(childFeature),
      {
        ...cloneDeep(parentFeature),
        ...{
          environmentSettings: {
            production: {
              enabled: false,
              rules: [],
            },
          },
        },
      },
    ];
    const payload = generateFeaturesPayload({
      features: features,
      environment: "production",
      groupMap: new Map(),
      experimentMap: new Map(),
    });
    // both parent and child should be scrubbed
    expect(payload).not.toHaveProperty("parent1");
    expect(payload).not.toHaveProperty("child1");
  });

  it("Does not block when top-level prerequisite has conditional state, creates inline gating rule", () => {
    const features: FeatureInterface[] = [
      cloneDeep(childFeature),
      {
        ...cloneDeep(parentFeature),
        ...{
          defaultValue: "false",
          environmentSettings: {
            production: {
              enabled: true,
              rules: [
                {
                  type: "force",
                  description: "",
                  id: "1",
                  value: "true",
                  condition: `{"country": "US"}`,
                  enabled: true,
                },
              ],
            },
          },
        },
      },
    ];
    const payload = generateFeaturesPayload({
      features: features,
      environment: "production",
      groupMap: new Map(),
      experimentMap: new Map(),
    });
    expect(payload).toHaveProperty("parent1");
    expect(payload).toHaveProperty("child1");
    // Prereq rules should be generated on the child because parent state is "conditional"
    expect(payload.child1.rules?.[0]).toStrictEqual({
      parentConditions: [
        { condition: { value: true }, gate: true, id: "parent1" },
      ],
    });
  });

  it("Blocks when top level prerequisite's parent is toggled off", () => {
    const features: FeatureInterface[] = [
      cloneDeep(childFeature),
      {
        ...cloneDeep(parentFeature),
        ...{
          prerequisites: [
            {
              id: "parent2",
              condition: `{"value": true}`,
            },
          ],
        },
      },
      {
        ...cloneDeep(parentFeature),
        ...{
          id: "parent2",
          environmentSettings: {
            production: {
              enabled: false,
              rules: [],
            },
          },
        },
      },
    ];
    const payload = generateFeaturesPayload({
      features: features,
      environment: "production",
      groupMap: new Map(),
      experimentMap: new Map(),
    });
    expect(payload).not.toHaveProperty("parent2");
    expect(payload).not.toHaveProperty("parent1");
    expect(payload).not.toHaveProperty("child1");
  });

  it("Blocks when multiple adjacent top level prerequisites where one is off", () => {
    const features: FeatureInterface[] = [
      {
        ...cloneDeep(childFeature),
        ...{
          prerequisites: [
            {
              id: "parent1",
              condition: `{"value": true}`,
            },
            {
              id: "parent2",
              condition: `{"value": true}`,
            },
          ],
        },
      },
      cloneDeep(parentFeature),
      {
        ...cloneDeep(parentFeature),
        ...{
          id: "parent2",
          environmentSettings: {
            production: {
              enabled: false,
              rules: [],
            },
          },
        },
      },
    ];
    const payload = generateFeaturesPayload({
      features: features,
      environment: "production",
      groupMap: new Map(),
      experimentMap: new Map(),
    });
    expect(payload).not.toHaveProperty("parent2");
    expect(payload).toHaveProperty("parent1");
    expect(payload).not.toHaveProperty("child1");
  });

  it("Appropriately scrubs prerequisite rules where the prerequisite is deterministic", () => {
    const features: FeatureInterface[] = [
      {
        ...cloneDeep(childFeature),
        ...{
          prerequisites: [],
          environmentSettings: {
            production: {
              enabled: true,
              rules: [
                {
                  type: "force",
                  description: "should keep, no prereqs",
                  id: "1",
                  value: "true",
                  condition: `{"country": "US-1"}`,
                  enabled: true,
                },
                {
                  type: "force",
                  description: "should remove, true !== false",
                  id: "2",
                  value: "true",
                  condition: `{"country": "US-2"}`,
                  prerequisites: [
                    {
                      id: "parent1",
                      condition: `{"value": true}`,
                    },
                  ],
                  enabled: true,
                },
                {
                  type: "force",
                  description: "should keep, false === false",
                  id: "3",
                  value: "true",
                  condition: `{"country": "US-3"}`,
                  prerequisites: [
                    {
                      id: "parent1",
                      condition: `{"value": false}`,
                    },
                  ],
                  enabled: true,
                },
                {
                  type: "force",
                  description: "should keep, feature exists",
                  id: "4",
                  value: "true",
                  condition: `{"country": "US-4"}`,
                  prerequisites: [
                    {
                      id: "parent1",
                      condition: `{"value": {"$exists": true}}`,
                    },
                  ],
                  enabled: true,
                },
                {
                  type: "force",
                  description:
                    "should remove, feature exists but checking not exists",
                  id: "5",
                  value: "true",
                  condition: `{"country": "US-5"}`,
                  prerequisites: [
                    {
                      id: "parent1",
                      condition: `{"value": {"$exists": false}}`,
                    },
                  ],
                  enabled: true,
                },
                {
                  type: "force",
                  description: "should remove, a prereq (parent2) is missing",
                  id: "6",
                  value: "true",
                  condition: `{"country": "US-6"}`,
                  prerequisites: [
                    {
                      id: "parent1",
                      condition: `{"value": false}`,
                    },
                    {
                      id: "parent2",
                      condition: `{"value": {"$exists": true}}`,
                    },
                  ],
                  enabled: true,
                },
                {
                  type: "force",
                  description: "should keep - complex condition",
                  id: "7",
                  value: "true",
                  condition: `{"country": "US-7"}`,
                  prerequisites: [
                    {
                      id: "parent1",
                      condition: `{"value": {"$in": [false, "foo", "bar"]}}`,
                    },
                  ],
                  enabled: true,
                },
                {
                  type: "force",
                  description: "should remove - complex condition",
                  id: "8",
                  value: "true",
                  condition: `{"country": "US-8"}`,
                  prerequisites: [
                    {
                      id: "parent1",
                      condition: `{"value": {"$in": [true, "foo", "bar"]}}`,
                    },
                  ],
                  enabled: true,
                },
              ],
            },
          },
        },
      },
      {
        ...cloneDeep(parentFeature),
        ...{
          defaultValue: "false",
        },
      },
    ];
    const payload = generateFeaturesPayload({
      features: features,
      environment: "production",
      groupMap: new Map(),
      experimentMap: new Map(),
    });
    expect(payload.child1.rules).toStrictEqual([
      {
        condition: { country: "US-1" },
        force: true,
        id: "1",
      },
      {
        condition: { country: "US-3" },
        force: true,
        id: "3",
      },
      {
        condition: { country: "US-4" },
        force: true,
        id: "4",
      },
      {
        condition: { country: "US-7" },
        force: true,
        id: "7",
      },
    ]);
  });

  it("Appropriately scrubs prerequisite rules where the prerequisite is conditional", () => {
    const features: FeatureInterface[] = [
      {
        ...cloneDeep(childFeature),
        ...{
          prerequisites: [],
          environmentSettings: {
            production: {
              enabled: true,
              rules: [
                {
                  type: "force",
                  description: "should keep, no prereqs",
                  id: "1",
                  value: "true",
                  condition: `{"country": "US-1"}`,
                  enabled: true,
                },
                {
                  type: "force",
                  description: "should remove, true !== false",
                  id: "2",
                  value: "true",
                  condition: `{"country": "US-2"}`,
                  prerequisites: [
                    {
                      id: "parent1",
                      condition: `{"value": true}`,
                    },
                  ],
                  enabled: true,
                },
                {
                  type: "force",
                  description: "should keep, false === false",
                  id: "3",
                  value: "true",
                  condition: `{"country": "US-3"}`,
                  prerequisites: [
                    {
                      id: "parent1",
                      condition: `{"value": false}`,
                    },
                  ],
                  enabled: true,
                },
                {
                  type: "force",
                  description: "should keep, feature exists",
                  id: "4",
                  value: "true",
                  condition: `{"country": "US-4"}`,
                  prerequisites: [
                    {
                      id: "parent1",
                      condition: `{"value": {"$exists": true}}`,
                    },
                  ],
                  enabled: true,
                },
                {
                  type: "force",
                  description:
                    "should remove, feature exists but checking not exists",
                  id: "5",
                  value: "true",
                  condition: `{"country": "US-5"}`,
                  prerequisites: [
                    {
                      id: "parent1",
                      condition: `{"value": {"$exists": false}}`,
                    },
                  ],
                  enabled: true,
                },
                {
                  type: "force",
                  description: "should remove, a prereq (parent2) is missing",
                  id: "6",
                  value: "true",
                  condition: `{"country": "US-6"}`,
                  prerequisites: [
                    {
                      id: "parent1",
                      condition: `{"value": false}`,
                    },
                    {
                      id: "parent2",
                      condition: `{"value": {"$exists": true}}`,
                    },
                  ],
                  enabled: true,
                },
                {
                  type: "force",
                  description: "should keep - complex condition",
                  id: "7",
                  value: "true",
                  condition: `{"country": "US-7"}`,
                  prerequisites: [
                    {
                      id: "parent1",
                      condition: `{"value": {"$in": [false, "foo", "bar"]}}`,
                    },
                  ],
                  enabled: true,
                },
                {
                  type: "force",
                  description: "should remove - complex condition",
                  id: "8",
                  value: "true",
                  condition: `{"country": "US-8"}`,
                  prerequisites: [
                    {
                      id: "parent1",
                      condition: `{"value": {"$in": [true, "foo", "bar"]}}`,
                    },
                  ],
                  enabled: true,
                },
              ],
            },
          },
        },
      },
      {
        ...cloneDeep(parentFeature),
        ...{
          defaultValue: "false",
          prerequisites: [
            {
              id: "parent2",
              condition: `{"value": true}`,
            },
          ],
        },
      },
      {
        ...cloneDeep(parentFeature),
        ...{
          id: "parent2",
          environmentSettings: {
            production: {
              enabled: true,
              rules: [
                {
                  type: "force",
                  description: "random rule to force conditional state",
                  id: "1",
                  value: "true",
                  condition: `{"foo": "bar"}`,
                  enabled: true,
                },
              ],
            },
          },
        },
      },
    ];

    const featuresMap = new Map(features.map((f) => [f.id, f]));
    const parent1State = evaluatePrerequisiteState(
      features[1],
      featuresMap,
      "production",
    );
    expect(parent1State.state).toEqual("conditional");

    const payload = generateFeaturesPayload({
      features: features,
      environment: "production",
      groupMap: new Map(),
      experimentMap: new Map(),
    });

    expect(payload.child1.rules).toStrictEqual([
      {
        condition: {
          country: "US-1",
        },
        force: true,
        id: "1",
      },
      {
        condition: {
          country: "US-2",
        },
        parentConditions: [
          {
            id: "parent1",
            condition: {
              value: true,
            },
          },
        ],
        force: true,
        id: "2",
      },
      {
        condition: {
          country: "US-3",
        },
        parentConditions: [
          {
            id: "parent1",
            condition: {
              value: false,
            },
          },
        ],
        force: true,
        id: "3",
      },
      {
        condition: {
          country: "US-4",
        },
        parentConditions: [
          {
            id: "parent1",
            condition: {
              value: {
                $exists: true,
              },
            },
          },
        ],
        force: true,
        id: "4",
      },
      {
        condition: {
          country: "US-5",
        },
        parentConditions: [
          {
            id: "parent1",
            condition: {
              value: {
                $exists: false,
              },
            },
          },
        ],
        force: true,
        id: "5",
      },
      {
        condition: {
          country: "US-6",
        },
        parentConditions: [
          {
            id: "parent1",
            condition: {
              value: false,
            },
          },
          {
            id: "parent2",
            condition: {
              value: {
                $exists: true,
              },
            },
          },
        ],
        force: true,
        id: "6",
      },
      {
        condition: {
          country: "US-7",
        },
        parentConditions: [
          {
            id: "parent1",
            condition: {
              value: {
                $in: [false, "foo", "bar"],
              },
            },
          },
        ],
        force: true,
        id: "7",
      },
      {
        condition: {
          country: "US-8",
        },
        parentConditions: [
          {
            id: "parent1",
            condition: {
              value: {
                $in: [true, "foo", "bar"],
              },
            },
          },
        ],
        force: true,
        id: "8",
      },
    ]);
  });
});
