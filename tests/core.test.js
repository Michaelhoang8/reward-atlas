import test from "node:test";
import assert from "node:assert/strict";
import { analyze, example, validate, quantile } from "../core.js";
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-10, `${a} != ${b}`);
const row = (action, reward, q = [0.2, 0.6]) => ({
  action,
  reward,
  behavior: [0.25, 0.75],
  target: [0.5, 0.5],
  q,
});
test("importance and DR averages recover target value on fully enumerated behavior frequencies", () => {
  const data = {
    actions: ["a", "b"],
    rows: [row(0, 1), row(1, 0), row(1, 0), row(1, 0)],
  };
  const r = analyze(data, { replicates: 50 });
  near(r.estimates.ips, 0.5);
  near(r.estimates.snips, 0.5);
  near(r.estimates.dr, 0.5);
  near(r.estimates.model, 0.4);
  near(r.estimates.logged, 0.25);
  near(r.diagnostics.weightSum, 4);
  near(r.diagnostics.ess, 3);
});
test("correct reward predictions eliminate DR residuals regardless of sampled actions", () => {
  const r = analyze(
    { actions: ["a", "b"], rows: [row(0, 1, [1, 0]), row(0, 1, [1, 0])] },
    { replicates: 50 },
  );
  near(r.estimates.dr, 0.5);
  near(r.estimates.ips, 2);
  near(r.estimates.snips, 1);
  near(r.intervals.dr.lower, 0.5);
  near(r.intervals.dr.upper, 0.5);
});
test("unsupported target mass suppresses causal estimates instead of extrapolating", () => {
  const r = analyze(
    { actions: ["a", "b"], rows: [{ ...row(0, 1), behavior: [1, 0] }] },
    { replicates: 50 },
  );
  assert.equal(r.identifiable, false);
  assert.equal(r.estimates.ips, null);
  assert.equal(r.estimates.dr, null);
  near(r.estimates.model, 0.4);
  near(r.diagnostics.unsupportedMass, 0.5);
  assert.equal(r.intervals.dr.valid, 0);
});
test("weight clipping is explicit and changes the estimand in a known direction", () => {
  const data = {
    actions: ["a", "b"],
    rows: [row(0, 1), row(1, 0), row(1, 0), row(1, 0)],
  };
  const r = analyze(data, { clip: 1, replicates: 50 });
  near(r.estimates.ips, 0.25);
  near(r.estimates.dr, 0.3);
  assert.equal(r.diagnostics.clippedRows, 1);
  assert.ok(r.diagnostics.ess > r.diagnostics.rawEss);
});
test("zero total weight and undefined bootstrap ratios remain explicit", () => {
  const data = {
    actions: ["a", "b"],
    rows: [{ ...row(0, 0), target: [0, 1] }],
  };
  const r = analyze(data, { replicates: 50 });
  assert.equal(r.estimates.snips, null);
  assert.equal(r.intervals.snips.valid, 0);
  assert.equal(r.intervals.snips.lower, null);
  near(r.diagnostics.ess, 0);
  const mixed = analyze(
    {
      actions: ["a", "b"],
      rows: [
        { ...row(0, 0), target: [0, 1] },
        { ...row(1, 1), target: [0, 1] },
      ],
    },
    { replicates: 100, seed: 17 },
  );
  assert.ok(mixed.intervals.snips.valid < 100);
  assert.equal(mixed.intervals.snips.upper, null);
});
test("seeded row bootstrap is reproducible and its percentile interpolation is type 7", () => {
  const data = example(17, 60).dataset;
  assert.deepEqual(analyze(data), analyze(data));
  near(quantile([0, 10, 20, 30], 0.25), 7.5);
  assert.equal(quantile([], 0.5), null);
  assert.notDeepEqual(
    analyze(data, { seed: 18 }).intervals,
    analyze(data, { seed: 19 }).intervals,
  );
});
test("strict row probability and resource boundaries", () => {
  for (const bad of [
    { ...row(0, 1), reward: true },
    { ...row(0, 1), behavior: [0, 1] },
    { ...row(0, 1), target: [0.2, 0.2] },
    { ...row(0, 1), q: [2, 0] },
    { ...row(0, 1), behavior: [1e-8, 1 - 1e-8] },
  ])
    assert.throws(() => validate({ actions: ["a", "b"], rows: [bad] }));
  for (const settings of [{ seed: 0 }, { clip: 0.5 }, { replicates: 10 }])
    assert.throws(() => analyze(example(17, 3).dataset, settings));
  assert.throws(() => validate({ actions: ["a", "a"], rows: [row(0, 1)] }));
});
test("300 random two-action populations recover the analytic target expectation", () => {
  let state = 73;
  const rand = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 2 ** 32;
  };
  for (let i = 0; i < 300; i++) {
    const k = 1 + Math.floor(rand() * 9),
      p = k / 10,
      t = rand(),
      rewards = [rand(), rand()],
      q = [rand(), rand()];
    const rows = Array.from({ length: 10 }, (_, j) => ({
      action: j < k ? 0 : 1,
      reward: rewards[j < k ? 0 : 1],
      behavior: [p, 1 - p],
      target: [t, 1 - t],
      q,
    }));
    const r = analyze({ actions: ["a", "b"], rows }, { replicates: 50 });
    const expected = t * rewards[0] + (1 - t) * rewards[1];
    near(r.estimates.ips, expected);
    near(r.estimates.dr, expected);
    near(r.estimates.snips, expected);
  }
});
