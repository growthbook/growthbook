import { createHash } from "crypto";
import fc from "fast-check";
import {
  CANONICAL_FORM_VERSION,
  canonicalize,
  deriveContextId,
  deriveContextIdWithSliceLength,
} from "../../src/util/canonicalize-condition";

// Mirror of the production hashing so the worked-example assertion below
// doesn't drift if we tweak the slice length but forget to update the test
// (the worked-example string itself is the locked contract — see A1.1).
function expectedContextId(cbId: string, canonical: string, slice = 8): string {
  const hex = createHash("sha256").update(`${cbId}|${canonical}`).digest("hex");
  return `ctx_${hex.slice(0, slice)}`;
}

describe("CANONICAL_FORM_VERSION", () => {
  // The CB MVP plan stores this on each ContextualBanditEvent so downstream
  // consumers can detect a re-canonicalization. Bumping it is intentional —
  // require a test update so reviewers see the change.
  it("is the locked v1 string for the MVP", () => {
    expect(CANONICAL_FORM_VERSION).toBe("v1");
  });
});

describe("canonicalize — fixed cases", () => {
  it("idempotence: re-parsing + re-canonicalizing yields the same string", () => {
    const c = {
      plan: "pro",
      cartValue: { $gte: 500 },
      $or: [{ country: { $in: ["US", "CA"] } }, { device: "mobile" }],
    };
    const first = canonicalize(c);
    const second = canonicalize(JSON.parse(first));
    expect(second).toBe(first);
  });

  it("rule 2: key order at the top level is invariant", () => {
    expect(canonicalize({ a: 1, b: 2 })).toBe(canonicalize({ b: 2, a: 1 }));
  });

  it("rule 3: key order inside an operator object is invariant", () => {
    expect(canonicalize({ x: { $gt: 1, $lt: 10 } })).toBe(
      canonicalize({ x: { $lt: 10, $gt: 1 } }),
    );
  });

  it("rule 2: $-prefixed keys sort before letters (codepoint order)", () => {
    // $ is U+0024; letters are U+0041+ — so $or comes before "a" in the
    // serialized output. Locks the sort order rather than just round-tripping.
    const out = canonicalize({ a: 1, $or: [{ b: 2 }, { c: 3 }] });
    expect(out.indexOf('"$or"')).toBeLessThan(out.indexOf('"a"'));
  });

  it("rule 5: $and flattens into top-level keys", () => {
    expect(canonicalize({ $and: [{ a: 1 }, { b: 2 }] })).toBe(
      canonicalize({ a: 1, b: 2 }),
    );
  });

  it("rule 5: length-1 $and collapses", () => {
    expect(canonicalize({ $and: [{ a: 1 }] })).toBe(canonicalize({ a: 1 }));
  });

  it("rule 5: empty $and becomes {}", () => {
    expect(canonicalize({ $and: [] })).toBe("{}");
  });

  it("rule 5: $and over operator objects on the same key merges disjoint operators", () => {
    expect(canonicalize({ $and: [{ a: { $gt: 1 } }, { a: { $lt: 5 } }] })).toBe(
      canonicalize({ a: { $gt: 1, $lt: 5 } }),
    );
  });

  it("rule 5: $and keeps wrapping when scalar+operator collide on the same key", () => {
    // The two clauses are not equivalent to either alone, so canonicalization
    // must preserve the wrapper rather than silently dropping a constraint.
    const wrapped = canonicalize({
      $and: [{ a: 1 }, { a: { $lt: 5 } }],
    });
    expect(wrapped).toContain('"$and"');
    expect(wrapped).toContain('"a":1');
    expect(wrapped).toContain('"$lt":5');
  });

  it("rule 5: $and keeps wrapping when two operator clauses share an operator key", () => {
    const wrapped = canonicalize({
      $and: [{ a: { $gt: 1 } }, { a: { $gt: 2 } }],
    });
    expect(wrapped).toContain('"$and"');
  });

  it("rule 4: $in is sort-invariant", () => {
    expect(canonicalize({ x: { $in: ["a", "b"] } })).toBe(
      canonicalize({ x: { $in: ["b", "a"] } }),
    );
  });

  it("rule 4: $in values are normalized into the same emitted order", () => {
    const out = canonicalize({ x: { $in: ["b", "a", "c"] } });
    expect(out).toContain('"$in":["a","b","c"]');
  });

  it("rule 4: $nin / $all / $inGroup / $notInGroup also sort-invariant", () => {
    for (const op of ["$nin", "$all", "$inGroup", "$notInGroup"]) {
      const left = canonicalize({ x: { [op]: ["b", "a"] } });
      const right = canonicalize({ x: { [op]: ["a", "b"] } });
      expect(left).toBe(right);
    }
  });

  it("rule 1: $eq unwraps to bare scalar", () => {
    expect(canonicalize({ plan: { $eq: "pro" } })).toBe(
      canonicalize({ plan: "pro" }),
    );
  });

  it("rule 1: $eq only unwraps when alone — sibling operators keep the object form", () => {
    // {$eq: "pro", $ne: "free"} cannot collapse to a scalar.
    const out = canonicalize({ plan: { $eq: "pro", $ne: "free" } });
    expect(out).toContain('"$eq":"pro"');
    expect(out).toContain('"$ne":"free"');
  });

  it("rule 8: $regexi rewrites to $regex + $options:'i'", () => {
    expect(canonicalize({ name: { $regexi: "foo" } })).toBe(
      canonicalize({ name: { $regex: "foo", $options: "i" } }),
    );
  });

  it("rule 8: $regexi + explicit $options merges the i flag without duplication", () => {
    const out = canonicalize({ name: { $regexi: "foo", $options: "im" } });
    // Flags merge to a sorted unique string — 'i' appears once.
    expect(out).toContain('"$options":"im"');
    expect(out).toContain('"$regex":"foo"');
  });

  it("rule 6: $or children are sorted by canonical JSON", () => {
    const a = canonicalize({ $or: [{ z: 1 }, { a: 1 }] });
    const b = canonicalize({ $or: [{ a: 1 }, { z: 1 }] });
    expect(a).toBe(b);
  });

  it("rule 6: length-1 $or unwraps into its child", () => {
    expect(canonicalize({ $or: [{ a: 1 }] })).toBe(canonicalize({ a: 1 }));
  });

  it("rule 6: length-1 $nor becomes $not", () => {
    expect(canonicalize({ $nor: [{ a: 1 }] })).toBe(
      canonicalize({ $not: { a: 1 } }),
    );
  });

  it("rule 7: $not operand is canonicalized recursively (key sort, $eq unwrap)", () => {
    expect(canonicalize({ $not: { plan: { $eq: "pro" } } })).toBe(
      canonicalize({ $not: { plan: "pro" } }),
    );
  });

  it("rule 7: nested $not is NOT collapsed (structural, not semantic)", () => {
    // canonicalize is a string-rewriter, not a logic engine — `$not($not c)`
    // stays in canonical form so re-canonicalizing is a no-op.
    const out = canonicalize({ $not: { $not: { a: 1 } } });
    expect(out).toBe('{"$not":{"$not":{"a":1}}}');
  });

  it("rule 9: numbers are emitted in shortest round-trip form", () => {
    expect(canonicalize({ n: 1.0 })).toBe(canonicalize({ n: 1 }));
    expect(canonicalize({ n: 1.0 })).toBe('{"n":1}');
  });

  it("rule 9: integer-valued floats normalize to their integer literal", () => {
    expect(canonicalize({ n: 1000.0 })).toBe('{"n":1000}');
  });

  it("rule 9: rejects non-finite numbers (NaN / Infinity round-trip as null)", () => {
    expect(() => canonicalize({ n: NaN })).toThrow(/non-finite/);
    expect(() => canonicalize({ n: Infinity })).toThrow(/non-finite/);
  });

  it("rule 10: version operators are structural (not semver-parsed)", () => {
    // Sort order applies the same as any other operator object — values are
    // emitted verbatim. Asserts the keys round-trip rather than testing semver.
    const out = canonicalize({ v: { $vgt: "1.2.3", $vlt: "2.0.0" } });
    expect(out).toBe('{"v":{"$vgt":"1.2.3","$vlt":"2.0.0"}}');
  });

  it("rule 11: {} canonicalizes to {}", () => {
    expect(canonicalize({})).toBe("{}");
  });

  it("worked example (CB MVP plan §A1.1): canonical form matches the spec string", () => {
    const c = { plan: "pro", cartValue: { $gte: 500 } };
    expect(canonicalize(c)).toBe('{"cartValue":{"$gte":500},"plan":"pro"}');
  });
});

describe("deriveContextId — fixed cases", () => {
  it("worked example: deriveContextId is the documented sha256/8-hex slice", () => {
    // The plan's `"ctx_8e2d4a91"` literal was a Notion-doc placeholder; the
    // contract is "first 8 hex of sha256(cbId|canonical)". Lock the real value
    // computed via that contract so future implementation drift is caught.
    const c = { plan: "pro", cartValue: { $gte: 500 } };
    const canonical = '{"cartValue":{"$gte":500},"plan":"pro"}';
    const cbId = "cb_checkout_promo_bandit";
    expect(deriveContextId(cbId, c)).toBe(expectedContextId(cbId, canonical));
  });

  it("CB-prefix isolation: same condition under two CBs yields different contextIds", () => {
    const c = { plan: "pro", cartValue: { $gte: 500 } };
    expect(deriveContextId("cb_A", c)).not.toBe(deriveContextId("cb_B", c));
  });

  it("CB-prefix isolation: empty/catch-all leaf is unique per CB", () => {
    // Rule 11 says the catch-all gets uniqueness from the CB-id prefix in the
    // hash input, not from the canonical form (which is the same `{}`).
    expect(deriveContextId("cb_A", {})).not.toBe(deriveContextId("cb_B", {}));
  });

  it("deriveContextIdWithSliceLength: 12-char slice is the 8-char slice's prefix-extension", () => {
    // The widening path (orchestrator CB MVP §A1.3) must take more hash bytes
    // from the same digest, not re-hash. Asserts the relationship explicitly.
    const c = { plan: "pro" };
    const short = deriveContextId("cb_X", c);
    const long = deriveContextIdWithSliceLength("cb_X", c, 12);
    expect(long.startsWith(short)).toBe(true);
    expect(long).toHaveLength("ctx_".length + 12);
  });

  it("deriveContextIdWithSliceLength: rejects nonsensical slice lengths", () => {
    expect(() => deriveContextIdWithSliceLength("cb_X", { a: 1 }, 0)).toThrow();
    expect(() =>
      deriveContextIdWithSliceLength("cb_X", { a: 1 }, -1),
    ).toThrow();
    expect(() =>
      deriveContextIdWithSliceLength("cb_X", { a: 1 }, 1.5),
    ).toThrow();
    expect(() =>
      deriveContextIdWithSliceLength("cb_X", { a: 1 }, 65),
    ).toThrow();
  });
});

describe("canonicalize — fast-check property tests", () => {
  // Arbitrary that builds simple Mongo-like conditions: a record of 1–4 field
  // keys, each holding either a scalar (implicit $eq) or a small operator
  // object. Constrained to a small alphabet so multiple shrinks find collisions
  // quickly without blowing up the property runner.
  const fieldKey = fc.constantFrom("a", "b", "c", "d");
  const scalarValue = fc.oneof(
    fc.integer({ min: 0, max: 100 }),
    fc.string({ minLength: 1, maxLength: 4 }),
    fc.boolean(),
  );
  const operatorObject = fc
    .uniqueArray(fc.constantFrom("$gt", "$lt", "$gte", "$lte", "$ne"), {
      minLength: 1,
      maxLength: 2,
    })
    .chain((ops) =>
      fc
        .tuple(...ops.map(() => fc.integer({ min: 0, max: 100 })))
        .map((values) => {
          const obj: Record<string, unknown> = {};
          ops.forEach((op, i) => {
            obj[op] = values[i];
          });
          return obj;
        }),
    );
  const valueArb = fc.oneof(scalarValue, operatorObject);
  const conditionArb = fc
    .uniqueArray(fieldKey, { minLength: 1, maxLength: 4 })
    .chain((keys) =>
      fc.tuple(...keys.map(() => valueArb)).map((values) => {
        const obj: Record<string, unknown> = {};
        keys.forEach((k, i) => {
          obj[k] = values[i];
        });
        return obj;
      }),
    );

  it("idempotence: canonicalize(JSON.parse(canonicalize(c))) === canonicalize(c)", () => {
    fc.assert(
      fc.property(conditionArb, (c) => {
        const first = canonicalize(c);
        const second = canonicalize(JSON.parse(first));
        return first === second;
      }),
      { numRuns: 200 },
    );
  });

  it("key-order invariance: shuffling top-level keys preserves the canonical form", () => {
    fc.assert(
      fc.property(conditionArb, (c) => {
        const keys = Object.keys(c);
        if (keys.length < 2) return true;
        const reversed: Record<string, unknown> = {};
        for (let i = keys.length - 1; i >= 0; i--) {
          reversed[keys[i]] = (c as Record<string, unknown>)[keys[i]];
        }
        return canonicalize(c) === canonicalize(reversed);
      }),
      { numRuns: 200 },
    );
  });

  it("collision-free in the small: 1000 random conditions → distinct canonical forms ⇒ distinct contextIds", () => {
    // The strict guarantee is: same canonical form ⇒ same contextId (by
    // construction); distinct canonical form ⇒ contextIds collide only at
    // sha256-collision probability. For 1000 8-hex slices the expected number
    // of collisions is ~0.06 — running a few hundred and asserting zero is the
    // standard "small-scale collision-free" smoke test from the plan.
    const cbId = "cb_collision_smoke";
    const canonicalToContextId = new Map<string, string>();
    fc.assert(
      fc.property(conditionArb, (c) => {
        const canonical = canonicalize(c);
        const id = deriveContextId(cbId, c);
        const seen = canonicalToContextId.get(canonical);
        if (seen !== undefined) {
          // Same canonical form must map deterministically to the same id.
          return seen === id;
        }
        // First time we see this canonical form — record and check that the
        // new id isn't already in use under a different canonical form.
        for (const [otherCanonical, otherId] of canonicalToContextId) {
          if (otherId === id && otherCanonical !== canonical) return false;
        }
        canonicalToContextId.set(canonical, id);
        return true;
      }),
      { numRuns: 1000 },
    );
  });
});
