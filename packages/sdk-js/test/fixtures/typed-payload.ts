import {
  FeatureApiResponse,
  GrowthBook,
  Payload,
} from "@growthbook/growthbook";

type AppAttributes = {
  id: string;
  name: string;
  age: number;
  beta?: boolean;
  plan?: "free" | "pro";
  tags: string[];
  company: { name: string; size?: number };
  orders: { total: number }[];
  custom: unknown;
};
type AppFeatures = { dark_mode: boolean; price: number };

// Everything a payload can hold, using real attributes
const payload: Payload<AppAttributes> = {
  features: {
    dark_mode: {
      defaultValue: false,
      rules: [
        {
          condition: {
            name: "Jane",
            age: { $gte: 18, $lt: 65, $in: [18, 21] },
            beta: true,
            plan: { $in: ["free", "pro"], $ne: "free" },
            id: { $regex: "^a", $vgt: "1.2.3", $inGroup: "group", $ini: ["A"] },
            tags: {
              $in: ["a"],
              $size: { $gt: 1 },
              $elemMatch: { $regex: "a" },
            },
            // Dot paths into object attributes
            "company.name": { $regexi: "acme" },
            "company.size": { $gt: 10 },
            company: { $exists: true },
            orders: { $elemMatch: { total: { $gt: 100 } } },
            // An attribute typed `unknown` or `any` takes any condition
            custom: { $regex: "x", anything: 1 },
            $or: [{ beta: { $not: true } }, { $not: { plan: null } }],
            $savedGroup: { id: "group", attributeKey: "company.name" },
          },
          // Prerequisites test feature values, not attributes
          parentConditions: [{ id: "price", condition: { value: { $gt: 1 } } }],
          force: true,
          hashAttribute: "id",
          fallbackAttribute: "name",
          filters: [{ attribute: "id", seed: "s", hashVersion: 2, ranges: [] }],
        },
      ],
    },
  },
  experiments: [
    {
      key: "exp",
      variations: [{}, { css: "a{}" }],
      condition: { tags: { $all: ["a", { $regex: "b" }] } },
      hashAttribute: "id",
    },
  ],
  savedGroups: {
    legacy: ["a", "b"],
    list: { type: "list", attributeKey: "id", values: ["a"] },
    cond: { type: "condition", condition: { age: { $gt: 1 } } },
  },
  interleavings: {
    search: {
      trackingKey: "s",
      hashAttribute: "id",
      seed: "s",
      variations: [],
    },
  },
};

// A checked payload is accepted wherever a payload is
const gb = new GrowthBook<AppFeatures, AppAttributes>();
gb.init({ fallbackPayload: payload });
gb.initSync({ payload });
gb.setPayload(payload);
export const untyped: FeatureApiResponse = payload;

type Features = NonNullable<Payload<AppAttributes>["features"]>;
type Rule = NonNullable<Features[string]["rules"]>[number];
type Condition = NonNullable<Rule["condition"]>;
type SavedGroup = NonNullable<Payload<AppAttributes>["savedGroups"]>[string];
type Interleavings = NonNullable<Payload<AppAttributes>["interleavings"]>;
const condition = (c: Condition) => c;
const rule = (r: Rule) => r;
const savedGroup = (g: SavedGroup) => g;
const interleaving = (i: Interleavings[string]) => i;

// @ts-expect-error unknown attribute
condition({ nope: 1 });
// @ts-expect-error unknown nested attribute
condition({ "company.nope": 1 });
// @ts-expect-error unknown attribute inside $or
condition({ $or: [{ nope: 1 }] });
// @ts-expect-error a string attribute can't equal a number
condition({ name: 123 });
// @ts-expect-error a number attribute can't equal a string
condition({ age: "18" });
// @ts-expect-error not one of the attribute's values
condition({ plan: "enterprise" });
// @ts-expect-error not one of the attribute's values
condition({ plan: { $in: ["enterprise"] } });
// @ts-expect-error $regex only works on strings
condition({ age: { $regex: "1" } });
// @ts-expect-error a number attribute is compared to numbers
condition({ age: { $gt: "18" } });
// @ts-expect-error a string attribute is compared to strings
condition({ name: { $lt: 5 } });
// @ts-expect-error a boolean attribute can't be ordered
condition({ beta: { $gt: 1 } });
// @ts-expect-error $size only works on arrays
condition({ name: { $size: 1 } });
// @ts-expect-error an array attribute never equals a string
condition({ tags: "a" });
// @ts-expect-error elements are strings
condition({ tags: { $in: [1] } });
// @ts-expect-error $elemMatch is checked against the element type
condition({ tags: { $elemMatch: { $gt: 1 } } });
// @ts-expect-error $elemMatch is checked against the element's fields
condition({ orders: { $elemMatch: { nope: 1 } } });
// @ts-expect-error the nested attribute is a number
condition({ "company.size": { $regex: "1" } });
// @ts-expect-error unknown operator
condition({ name: { $nope: 1 } });
// @ts-expect-error $not is checked like the value itself
condition({ age: { $not: { $regex: "1" } } });
// @ts-expect-error unknown attribute on a saved group reference
condition({ $savedGroup: { id: "group", attributeKey: "nope" } });

// @ts-expect-error unknown hash attribute
rule({ hashAttribute: "nope" });
// @ts-expect-error unknown fallback attribute
rule({ fallbackAttribute: "nope" });
// @ts-expect-error hashing doesn't look inside object attributes
rule({ hashAttribute: "company.name" });
// @ts-expect-error a boolean attribute can't be hashed
rule({ hashAttribute: "beta" });
// @ts-expect-error an array attribute can't be hashed
rule({ fallbackAttribute: "tags" });
// A number can be hashed, and an attribute typed `unknown` isn't checked
rule({ hashAttribute: "age", fallbackAttribute: "custom" });
// @ts-expect-error unknown filter attribute
rule({ filters: [{ attribute: "x", seed: "", hashVersion: 2, ranges: [] }] });
// @ts-expect-error unknown attribute in a rule's condition
rule({ condition: { nope: 1 } });
// @ts-expect-error unknown attribute in an experiment rule's condition
rule({ variations: [1, 2], condition: { nope: 1 } });
// @ts-expect-error unknown saved group attribute
savedGroup({ type: "list", attributeKey: "nope", values: [] });
// @ts-expect-error unknown attribute in a saved group's condition
savedGroup({ type: "condition", condition: { nope: 1 } });
// @ts-expect-error unknown hash attribute
interleaving({ trackingKey: "", hashAttribute: "x", seed: "", variations: [] });
export const badExperiment: Payload<AppAttributes> = {
  // @ts-expect-error unknown attribute in an auto experiment's condition
  experiments: [{ key: "a", variations: [{}, {}], condition: { nope: 1 } }],
};

// The second generic checks feature keys and values as well
type Typed = Payload<AppAttributes, AppFeatures>;
export const both: Typed = {
  features: {
    price: { defaultValue: 1, rules: [{ condition: { age: 1 }, force: 2 }] },
    dark_mode: { defaultValue: false, rules: [{ variations: [true, false] }] },
  },
};
// Features can be left out, and a feature doesn't need a defaultValue
export const partial: Typed = {
  features: { price: { rules: [{ force: 1 }] } },
};
export const noFeatures: Typed = {};
export const unknownFeature: Typed = {
  // @ts-expect-error unknown feature
  features: { nope: { defaultValue: 1 } },
};
export const wrongValue: Typed = {
  // @ts-expect-error wrong value type
  features: { price: { defaultValue: "1" } },
};
export const wrongForce: Typed = {
  features: {
    // @ts-expect-error a rule's value must match the feature's type
    dark_mode: { defaultValue: false, rules: [{ force: "yes" }] },
  },
};
export const wrongVariation: Typed = {
  features: {
    // @ts-expect-error a variation must match the feature's type
    price: { defaultValue: 1, rules: [{ variations: [1, "2"] }] },
  },
};

// With no types at all, any feature and any condition is accepted
export const loose: Payload = {
  features: {
    f: { rules: [{ condition: { anything: { $gt: 1 } }, hashAttribute: "x" }] },
  },
};
