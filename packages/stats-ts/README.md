# stats-ts

A framework-agnostic TypeScript port of the GrowthBook statistical engine
(`packages/stats`, written in Python/`gbstats`).

This package exists so stats computations can run in-process — without spawning
the Python stats engine — and be shared by any consumer (back-end today,
front-end later). It deliberately has **no** dependency on `back-end` or
`front-end`: everything here is a pure function over plain data plus the shared
types in `shared`.

## Import boundaries

| Package  | Can import from |
| -------- | --------------- |
| stats-ts | shared          |

`stats-ts` must not import from `back-end` or `front-end`. Keep every export a
pure function: no Mongo, no Express, no request context. Callers are
responsible for loading data and resolving settings, then passing plain values
in.

## Contents

- `computeContextualBanditWeights` — TypeScript port of the gbstats
  contextual-bandit weight pipeline (per-context statistics → greedy SSE
  regression tree → per-leaf Gaussian-Gaussian Thompson weighting).

## Scripts

```bash
pnpm --filter stats-ts build       # compile to dist/
pnpm --filter stats-ts test        # run jest
pnpm --filter stats-ts type-check  # tsgo --noEmit
```
