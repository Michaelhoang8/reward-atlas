export function rng(seed) {
  if (!Number.isInteger(seed) || seed < 1 || seed > 4294967295)
    throw Error("Seed must be a nonzero unsigned 32-bit integer.");
  let state = seed;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}
export function validate(raw) {
  if (
    !raw ||
    !Array.isArray(raw.actions) ||
    raw.actions.length < 2 ||
    raw.actions.length > 5 ||
    raw.actions.some(
      (x) =>
        typeof x !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,23}$/.test(x),
    ) ||
    new Set(raw.actions).size !== raw.actions.length
  )
    throw Error("Provide 2–5 unique ASCII action names.");
  if (!Array.isArray(raw.rows) || raw.rows.length < 1 || raw.rows.length > 2000)
    throw Error("Provide 1–2,000 logged rows.");
  const k = raw.actions.length;
  function vector(values, probability) {
    if (
      !Array.isArray(values) ||
      values.length !== k ||
      values.some(
        (v) => typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1,
      )
    )
      throw Error("Vectors must contain one finite [0,1] value per action.");
    if (!probability) return [...values];
    const sum = values.reduce((a, b) => a + b, 0);
    if (Math.abs(sum - 1) > 1e-9)
      throw Error("Behavior and target probabilities must sum to one.");
    return values.map((v) => v / sum);
  }
  const rows = raw.rows.map((r, i) => {
    if (
      !r ||
      !Number.isInteger(r.action) ||
      r.action < 0 ||
      r.action >= k ||
      typeof r.reward !== "number" ||
      !Number.isFinite(r.reward) ||
      r.reward < 0 ||
      r.reward > 1
    )
      throw Error(`Row ${i + 1}: invalid action index or bounded reward.`);
    const behavior = vector(r.behavior, true),
      target = vector(r.target, true),
      q = vector(r.q, false);
    if (behavior.some((p) => p > 0 && p < 1e-6))
      throw Error("Positive behavior probabilities must be at least 0.000001.");
    if (behavior[r.action] === 0)
      throw Error(
        `Row ${i + 1}: the logged action has zero behavior probability.`,
      );
    return { action: r.action, reward: r.reward, behavior, target, q };
  });
  return { actions: [...raw.actions], rows };
}
export function quantile(sorted, p) {
  if (!sorted.length) return null;
  const i = (sorted.length - 1) * p,
    low = Math.floor(i);
  return sorted[low] + (sorted[Math.ceil(i)] - sorted[low]) * (i - low);
}
function aggregate(rows, indices = null) {
  let weighted = 0,
    weight = 0,
    dr = 0,
    model = 0,
    reward = 0;
  const n = indices ? indices.length : rows.length;
  for (let i = 0; i < n; i++) {
    const r = rows[indices ? indices[i] : i];
    weighted += r.weight * r.reward;
    weight += r.weight;
    dr += r.dr;
    model += r.model;
    reward += r.reward;
  }
  return {
    ips: weighted / n,
    snips: weight > 0 ? weighted / weight : null,
    dr: dr / n,
    model: model / n,
    logged: reward / n,
  };
}
export function analyze(raw, { clip = 0, replicates = 200, seed = 73 } = {}) {
  const dataset = validate(raw);
  if (
    !Number.isFinite(clip) ||
    clip < 0 ||
    clip > 1000 ||
    (clip > 0 && clip < 1)
  )
    throw Error("Weight cap must be zero (none) or between 1 and 1,000.");
  if (!Number.isInteger(replicates) || replicates < 50 || replicates > 1000)
    throw Error("Use 50–1,000 bootstrap replicates.");
  const random = rng(seed);
  const rows = dataset.rows.map((r, i) => {
    const rawWeight = r.target[r.action] / r.behavior[r.action],
      weight = clip ? Math.min(clip, rawWeight) : rawWeight,
      model = r.target.reduce((sum, p, j) => sum + p * r.q[j], 0),
      unsupported = r.target.reduce(
        (sum, p, j) => sum + (r.behavior[j] === 0 ? p : 0),
        0,
      );
    return {
      index: i + 1,
      action: r.action,
      reward: r.reward,
      behavior: r.behavior[r.action],
      target: r.target[r.action],
      rawWeight,
      weight,
      model,
      dr: model + weight * (r.reward - r.q[r.action]),
      unsupported,
    };
  });
  const missing = rows.filter((r) => r.unsupported > 0),
    identifiable = missing.length === 0,
    summary = aggregate(rows),
    draws = { ips: [], snips: [], dr: [] };
  if (identifiable)
    for (let b = 0; b < replicates; b++) {
      const indices = Array.from({ length: rows.length }, () =>
        Math.floor(random() * rows.length),
      );
      const stats = aggregate(rows, indices);
      for (const key of Object.keys(draws))
        if (stats[key] !== null) draws[key].push(stats[key]);
    }
  const intervals = {};
  for (const [key, values] of Object.entries(draws)) {
    values.sort((a, b) => a - b);
    intervals[key] = {
      valid: values.length,
      requested: replicates,
      lower: values.length === replicates ? quantile(values, 0.025) : null,
      upper: values.length === replicates ? quantile(values, 0.975) : null,
    };
  }
  const sum = rows.reduce((s, r) => s + r.weight, 0),
    squares = rows.reduce((s, r) => s + r.weight * r.weight, 0),
    rawSum = rows.reduce((s, r) => s + r.rawWeight, 0),
    rawSquares = rows.reduce((s, r) => s + r.rawWeight * r.rawWeight, 0);
  return {
    format: "reward-atlas-evidence-v1",
    dataset,
    settings: { clip, replicates, seed },
    identifiable,
    estimates: {
      ...summary,
      ips: identifiable ? summary.ips : null,
      snips: identifiable ? summary.snips : null,
      dr: identifiable ? summary.dr : null,
    },
    intervals,
    diagnostics: {
      rows: rows.length,
      unsupportedRows: missing.length,
      unsupportedMass:
        rows.reduce((s, r) => s + r.unsupported, 0) / rows.length,
      ess: squares ? (sum * sum) / squares : 0,
      rawEss: rawSquares ? (rawSum * rawSum) / rawSquares : 0,
      weightSum: sum,
      maxWeight: Math.max(...rows.map((r) => r.rawWeight)),
      clippedRows: rows.filter((r) => r.weight < r.rawWeight).length,
      zeroWeights: rows.filter((r) => r.weight === 0).length,
    },
    rows,
  };
}
export function example(seed = 17, count = 600) {
  if (!Number.isInteger(count) || count < 1 || count > 2000)
    throw Error("Example size must be an integer from 1 to 2,000.");
  const random = rng(seed),
    truth = [
      [0.8, 0.45, 0.25],
      [0.3, 0.75, 0.4],
      [0.2, 0.45, 0.85],
    ],
    q = [
      [0.72, 0.5, 0.3],
      [0.35, 0.68, 0.45],
      [0.25, 0.5, 0.76],
    ],
    behavior = [0.65, 0.25, 0.1];
  const rows = [];
  let expected = 0;
  for (let i = 0; i < count; i++) {
    const group = i % 3,
      target = Array.from({ length: 3 }, (_, j) => (j === group ? 0.8 : 0.1)),
      draw = random();
    const action = draw < 0.65 ? 0 : draw < 0.9 ? 1 : 2,
      reward = Number(random() < truth[group][action]);
    rows.push({
      action,
      reward,
      behavior: [...behavior],
      target,
      q: [...q[group]],
    });
    expected += target.reduce((s, p, j) => s + p * truth[group][j], 0);
  }
  return {
    dataset: { actions: ["Guide", "Compare", "Explore"], rows },
    simulationTruth: expected / count,
  };
}
