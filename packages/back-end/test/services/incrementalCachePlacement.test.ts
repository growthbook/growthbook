import {
  compareCacheMetrics,
  planIncrementalCaches,
  type CacheMetric,
  type StoredCache,
} from "back-end/src/services/experimentQueries/incrementalCachePlacement";
import {
  BASE_COLUMNS_PER_QUERY,
  MAX_METRICS_PER_QUERY,
} from "back-end/src/services/experimentQueries/constants";

// Room for this many metric columns in each cache.
const budget = (columns: number) => BASE_COLUMNS_PER_QUERY + columns;

const m = (metricId: string, columns: number, cacheKind = "ft_a") =>
  ({ metricId, cacheKind, columns }) satisfies CacheMetric;

const stored = (
  groupId: string,
  metrics: CacheMetric[],
  cacheKind = "ft_a",
): StoredCache => ({ groupId, cacheKind, metrics });

const layout = (caches: ReturnType<typeof planIncrementalCaches>) =>
  caches.map(
    (c) =>
      `${c.cacheKind}${c.replacesGroupId ? `<${c.replacesGroupId}` : ""}:${c.metricIds.join(",")}`,
  );

describe("compareCacheMetrics", () => {
  it("orders by kind, then larger metrics first, then by definition next to its slices", () => {
    const metrics = [
      m("b", 3),
      m("a?dim:country=US", 3),
      m("c", 6),
      m("a", 3),
      m("z", 9, "ft_0"),
    ];
    expect(metrics.sort(compareCacheMetrics).map((x) => x.metricId)).toEqual([
      "z",
      "c",
      "a",
      "a?dim:country=US",
      "b",
    ]);
  });
});

describe("planIncrementalCaches", () => {
  it("packs from scratch smallest-first in canonical order", () => {
    // Budget 9: A (6) opens a cache, B (3) fills it, C (3) needs another.
    expect(
      layout(
        planIncrementalCaches({
          metrics: [m("C", 3), m("A", 6), m("B", 3)],
          storedCaches: [],
          maxColumns: budget(9),
        }),
      ),
    ).toEqual(["ft_a:A,B", "ft_a:C"]);
  });

  it("does not depend on the order metrics are listed in", () => {
    const metrics = [
      m("m1", 6),
      m("m2", 3),
      m("m3", 9),
      m("m4", 3),
      m("m5", 6),
      m("q1", 48, "ft_a_qtile"),
      m("b1", 3, "ft_b"),
    ];
    const plan = (list: CacheMetric[]) =>
      layout(
        planIncrementalCaches({
          metrics: list,
          storedCaches: [],
          maxColumns: budget(12),
        }),
      );
    const expected = plan(metrics);
    expect(plan([...metrics].reverse())).toEqual(expected);
    expect(
      plan([metrics[3], ...metrics.slice(4), ...metrics.slice(0, 3)]),
    ).toEqual(expected);
  });

  it("depends on the order metrics were added over time", () => {
    // Added as A, then C, then B: {A, C} and {B}. From scratch: {A, B} and {C}.
    const first = planIncrementalCaches({
      metrics: [m("A", 6)],
      storedCaches: [],
      maxColumns: budget(9),
    });
    expect(layout(first)).toEqual(["ft_a:A"]);
    const second = planIncrementalCaches({
      metrics: [m("C", 3)],
      storedCaches: [stored("g1", [m("A", 6)])],
      maxColumns: budget(9),
    });
    expect(layout(second)).toEqual(["ft_a<g1:A,C"]);
    expect(
      layout(
        planIncrementalCaches({
          metrics: [m("B", 3)],
          storedCaches: [stored("g2", [m("A", 6), m("C", 3)])],
          maxColumns: budget(9),
        }),
      ),
    ).toEqual(["ft_a:B"]);
  });

  it("puts a new metric in the stored cache with the fewest columns, leaving the others out", () => {
    expect(
      layout(
        planIncrementalCaches({
          metrics: [m("new", 3)],
          storedCaches: [
            stored("big", [m("x", 6), m("y", 6)]),
            stored("small", [m("z", 9)]),
            stored("other_kind", [m("q", 1)], "ft_a_qtile"),
          ],
          maxColumns: budget(100),
        }),
      ),
    ).toEqual(["ft_a<small:z,new"]);
  });

  it("counts a cache as full at the column budget, not before", () => {
    const storedCaches = [stored("g", [m("x", 6)])];
    expect(
      layout(
        planIncrementalCaches({
          metrics: [m("fits", 3)],
          storedCaches,
          maxColumns: budget(9),
        }),
      ),
    ).toEqual(["ft_a<g:x,fits"]);
    expect(
      layout(
        planIncrementalCaches({
          metrics: [m("too_big", 4)],
          storedCaches,
          maxColumns: budget(9),
        }),
      ),
    ).toEqual(["ft_a:too_big"]);
  });

  it("opens a new cache once a cache holds the most metrics a query takes", () => {
    const full = stored(
      "full",
      Array.from({ length: MAX_METRICS_PER_QUERY }, (_, i) => m(`x${i}`, 1)),
    );
    expect(
      layout(
        planIncrementalCaches({
          metrics: [m("new", 1)],
          storedCaches: [full],
          maxColumns: budget(10_000),
        }),
      ),
    ).toEqual(["ft_a:new"]);
  });

  it("never mixes kinds of cache", () => {
    expect(
      layout(
        planIncrementalCaches({
          metrics: [m("q", 9, "ft_a_qtile"), m("c", 3, "cluster_ft_a")],
          storedCaches: [stored("plain", [m("x", 3)])],
          maxColumns: budget(100),
        }),
      ),
    ).toEqual(["cluster_ft_a:c", "ft_a_qtile:q"]);
  });

  it("lets new metrics follow each other into the cache they open before rebuilding a stored one", () => {
    // n3 ties g and the new cache on columns; it joins the new cache, which
    // this run builds anyway.
    expect(
      layout(
        planIncrementalCaches({
          metrics: [m("n1", 6), m("n2", 3), m("n3", 3)],
          storedCaches: [stored("g", [m("x", 9)])],
          maxColumns: budget(12),
        }),
      ),
    ).toEqual(["ft_a:n1,n2,n3"]);
  });

  describe("ties", () => {
    it("go to the cache with fewer metrics", () => {
      expect(
        layout(
          planIncrementalCaches({
            metrics: [m("new", 1)],
            storedCaches: [
              stored("a_many", [m("x", 3), m("y", 3)]),
              stored("b_few", [m("z", 6)]),
            ],
            maxColumns: budget(100),
          }),
        ),
      ).toEqual(["ft_a<b_few:z,new"]);
    });

    it("go to a cache this run already builds, before one with fewer metrics", () => {
      // n1 joins a (3 < 6), which then ties b; n2 follows n1 instead of
      // rebuilding b as well.
      expect(
        layout(
          planIncrementalCaches({
            metrics: [m("n1", 3), m("n2", 3)],
            storedCaches: [stored("a", [m("x", 3)]), stored("b", [m("y", 6)])],
            maxColumns: budget(100),
          }),
        ),
      ).toEqual(["ft_a<a:n1,n2,x"]);
    });

    it("go to the cache already joined with another side of the metric", () => {
      // r1 is stored in a1 (ft_a) and b2 (ft_b). The new ratio's ft_a side
      // lands in a1, so its ft_b side prefers b2 over the tied b1.
      const plan = planIncrementalCaches({
        metrics: [m("r_new", 6, "ft_a"), m("r_new", 6, "ft_b")],
        storedCaches: [
          stored("a1", [m("r1", 6, "ft_a")], "ft_a"),
          stored("b1", [m("y", 6, "ft_b")], "ft_b"),
          stored("b2", [m("r1", 6, "ft_b")], "ft_b"),
        ],
        maxColumns: budget(100),
      });
      expect(layout(plan)).toEqual(["ft_a<a1:r1,r_new", "ft_b<b2:r1,r_new"]);
    });

    it("go to the cache whose first metric sorts first, whatever its group id", () => {
      expect(
        layout(
          planIncrementalCaches({
            metrics: [m("new", 1)],
            storedCaches: [
              stored("g1", [m("y", 3)]),
              stored("g2", [m("x", 3)]),
            ],
            maxColumns: budget(100),
          }),
        ),
      ).toEqual(["ft_a<g2:x,new"]);
    });

    it("break the same way as a full refresh, whichever random id the first cache got", () => {
      // 52 metrics of 34 columns pack into two caches of 26, which tie on
      // every count; the added metric sorts last.
      const metrics = Array.from({ length: 52 }, (_, i) =>
        m(`big${String(i).padStart(2, "0")}`, 34),
      );
      const added = m("zz_plain", 3);
      const membership = (
        caches: { cacheKind: string; metricIds: string[] }[],
      ) =>
        caches
          .map((c) => `${c.cacheKind}:${[...c.metricIds].sort().join(",")}`)
          .sort();
      const before = planIncrementalCaches({
        metrics,
        storedCaches: [],
        maxColumns: 1000,
      });
      expect(before.map((c) => c.metricIds.length)).toEqual([26, 26]);
      const fullRefresh = membership(
        planIncrementalCaches({
          metrics: [...metrics, added],
          storedCaches: [],
          maxColumns: 1000,
        }),
      );

      for (const groupIds of [
        ["ft_a_b0", "ft_a_a1"],
        ["ft_a_a0", "ft_a_b1"],
      ]) {
        const storedCaches = before.map((c, i) =>
          stored(
            groupIds[i],
            c.metricIds.map((id) => m(id, 34)),
          ),
        );
        const update = planIncrementalCaches({
          metrics: [added],
          storedCaches,
          maxColumns: 1000,
        });
        expect(
          membership([
            ...storedCaches
              .filter((c) => c.groupId !== update[0].replacesGroupId)
              .map((c) => ({
                cacheKind: c.cacheKind,
                metricIds: c.metrics.map((x) => x.metricId),
              })),
            ...update,
          ]),
        ).toEqual(fullRefresh);
      }
    });
  });

  describe("several new metrics of one kind", () => {
    it("go together into the smallest stored cache that fits them all", () => {
      // A metric and its two slices: g1 alone has room for all three, so g2 is
      // left alone even once g1 has more columns than g2.
      expect(
        layout(
          planIncrementalCaches({
            metrics: [m("n", 3), m("n?dim:c=1", 3), m("n?dim:c=2", 3)],
            storedCaches: [
              stored("g1", [m("x", 300)]),
              stored("g2", [m("y", 300)]),
            ],
            maxColumns: 1000,
          }),
        ),
      ).toEqual(["ft_a<g1:x,n,n?dim:c=1,n?dim:c=2"]);
    });

    it("skip a smaller cache that can't take them all", () => {
      // g1 has the fewest columns but room for only two more metrics.
      const nearlyFull = Array.from(
        { length: MAX_METRICS_PER_QUERY - 2 },
        (_, i) => m(`x${String(i).padStart(3, "0")}`, 1),
      );
      const plan = planIncrementalCaches({
        metrics: [m("n1", 3), m("n2", 3), m("n3", 3)],
        storedCaches: [stored("g1", nearlyFull), stored("g2", [m("y", 300)])],
        maxColumns: budget(1000),
      });
      expect(plan.map((c) => [c.replacesGroupId, c.metricIds])).toEqual([
        ["g2", ["y", "n1", "n2", "n3"]],
      ]);
    });

    it("spread over as few stored caches as they need when none fits them all", () => {
      // 12 columns, and no cache has room for more than 10. Placing each
      // metric on its own in the smallest cache would rebuild all three.
      expect(
        layout(
          planIncrementalCaches({
            metrics: [m("n1", 6), m("n2", 3), m("n3", 3)],
            storedCaches: [
              stored("g1", [m("x", 90)]),
              stored("g2", [m("y", 92)]),
              stored("g3", [m("z", 93)]),
            ],
            maxColumns: budget(100),
          }),
        ),
      ).toEqual(["ft_a<g1:x,n1", "ft_a<g2:y,n2,n3"]);
    });

    it("fill the cache they rebuild before rebuilding another", () => {
      // 9 columns, and no cache has room for more than 6. n1 rebuilds g1, n2
      // follows it, and only n3 needs another cache.
      expect(
        layout(
          planIncrementalCaches({
            metrics: [m("n1", 3), m("n2", 3), m("n3", 3)],
            storedCaches: [
              stored("g1", [m("x", 94)]),
              stored("g2", [m("y", 95)]),
            ],
            maxColumns: budget(100),
          }),
        ),
      ).toEqual(["ft_a<g1:x,n1,n2", "ft_a<g2:y,n3"]);
    });

    it("open one new cache for them all when no stored cache has room", () => {
      expect(
        layout(
          planIncrementalCaches({
            metrics: [m("n1", 3), m("n2", 3), m("n3", 3)],
            storedCaches: [stored("g1", [m("x", 98)])],
            maxColumns: budget(100),
          }),
        ),
      ).toEqual(["ft_a:n1,n2,n3"]);
    });

    it("are placed the same whatever order they are listed in", () => {
      const metrics = [
        m("n", 6),
        m("n?dim:c=1", 3),
        m("n?dim:c=2", 3),
        m("p", 9),
        m("q", 3, "ft_b"),
      ];
      const storedCaches = [
        stored("g1", [m("x", 80)]),
        stored("g2", [m("y", 85)]),
        stored("b1", [m("z", 3, "ft_b")], "ft_b"),
      ];
      const plan = (list: CacheMetric[]) =>
        planIncrementalCaches({
          metrics: list,
          storedCaches,
          maxColumns: budget(100),
        });
      expect(plan([...metrics].reverse())).toEqual(plan(metrics));
      expect(
        plan([metrics[2], metrics[4], metrics[0], metrics[3], metrics[1]]),
      ).toEqual(plan(metrics));
    });
  });

  it("returns nothing when there is nothing to place", () => {
    expect(
      planIncrementalCaches({
        metrics: [],
        storedCaches: [stored("g", [m("x", 3)])],
        maxColumns: budget(100),
      }),
    ).toEqual([]);
  });
});
