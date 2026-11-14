import { example } from "./core.js";
const $ = (id) => document.getElementById(id);
let result = null,
  truth = null,
  busy = false,
  dirty = true;
const value = (n) =>
  n === null
    ? "Unavailable"
    : n.toLocaleString(undefined, {
        minimumFractionDigits: 3,
        maximumFractionDigits: 3,
      });
function notice(text, error = false) {
  $("notice").textContent = text;
  $("notice").className = error ? "error" : "";
  $("edit-notice").textContent = text;
  $("edit-notice").className = error ? "error" : "";
}
function controls() {
  document
    .querySelectorAll("button,input,select,textarea")
    .forEach((e) => (e.disabled = busy));
  $("export").disabled = $("csv").disabled = busy || dirty || !result;
}
function invalidate() {
  dirty = true;
  controls();
  notice(
    "Inputs changed. Evaluate again to update the displayed results and exports.",
  );
}
function preset() {
  const fixture = example();
  if ($("preset").value === "gap") {
    fixture.dataset.rows = fixture.dataset.rows
      .filter((r) => r.action !== 2)
      .map((r) => ({ ...r, behavior: [0.72, 0.28, 0] }));
    truth = null;
  } else truth = fixture.simulationTruth;
  $("dataset").value = JSON.stringify(fixture.dataset, null, 2);
  $("clip").value = "0";
  dirty = true;
  compute();
}
function svg(tag, attrs, text) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (text !== undefined) el.textContent = text;
  return el;
}
function render() {
  const r = result,
    d = r.diagnostics;
  $("estimate").textContent = r.identifiable ? value(r.estimates.dr) : "—";
  $("interpretation").textContent = !r.identifiable
    ? "Target probability reaches actions absent from the logging policy. Policy-value estimates are withheld."
    : r.settings.clip
      ? `Weight cap ${r.settings.clip} applied to IPS and DR corrections. Clipping can introduce bias.`
      : "Estimated target reward per decision. Values are not clamped to the reward range.";
  $("ess").textContent = d.ess.toFixed(1);
  $("weight").textContent = value(d.maxWeight);
  $("truth").textContent = truth === null ? "Unknown" : value(truth);
  $("logged").textContent =
    `Observed logging reward: ${value(r.estimates.logged)}`;
  $("model-only").textContent =
    `Model-only prediction: ${value(r.estimates.model)}`;
  $("support").textContent =
    `${d.unsupportedRows} rows without full target support`;
  $("conditions").textContent =
    `${d.rows} rows · ${d.clippedRows} clipped · ${d.zeroWeights} zero weights · ${r.settings.replicates} seeded bootstrap draws. ${d.unsupportedRows ? "Support violations prevent identification from these logs." : "Intervals assume independent, representative rows and fixed evaluation inputs; they are not guaranteed coverage."} ${r.intervals.snips.valid < r.settings.replicates && r.identifiable ? "Some bootstrap draws have zero total weight; the SNIPS interval is unavailable." : ""}`;
  const chart = $("chart");
  chart.replaceChildren();
  $("support-message").hidden = r.identifiable;
  chart.parentElement.hidden = !r.identifiable;
  $("support-message").textContent =
    `Policy-value estimates withheld. The logging policy must support the target policy. Average unsupported target mass: ${(d.unsupportedMass * 100).toFixed(1)}%. The model-only number is extrapolation.`;
  if (!r.identifiable) {
    chart.append(
      svg(
        "text",
        { x: 30, y: 100, class: "name" },
        "The logging policy must support the target policy.",
      ),
    );
    chart.append(
      svg(
        "text",
        { x: 30, y: 135 },
        `Average unsupported target mass: ${(d.unsupportedMass * 100).toFixed(1)}%. The model-only number is extrapolation.`,
      ),
    );
  } else {
    const all = [
      0,
      1,
      ...["ips", "snips", "dr"]
        .flatMap((k) => [
          r.estimates[k],
          r.intervals[k].lower,
          r.intervals[k].upper,
        ])
        .filter((v) => v !== null),
      ...(truth === null ? [] : [truth]),
    ];
    const low = Math.floor(Math.min(...all) * 4) / 4,
      high = Math.ceil(Math.max(...all) * 4) / 4,
      x = (v) => 180 + ((v - low) / (high - low)) * 650;
    for (let i = 0; i <= 4; i++) {
      const v = low + ((high - low) * i) / 4;
      chart.append(
        svg("line", { x1: x(v), y1: 15, x2: x(v), y2: 230, class: "grid" }),
      );
      chart.append(
        svg("text", { x: x(v), y: 260, "text-anchor": "middle" }, v.toFixed(2)),
      );
    }
    if (truth !== null)
      chart.append(
        svg("line", {
          x1: x(truth),
          y1: 15,
          x2: x(truth),
          y2: 230,
          class: "truth",
        }),
      );
    ["ips", "snips", "dr"].forEach((k, i) => {
      const y = 55 + i * 75,
        interval = r.intervals[k],
        estimate = r.estimates[k];
      chart.append(
        svg(
          "text",
          { x: 10, y: y + 6, class: "name" },
          `${r.settings.clip ? "Clipped " : ""}${k.toUpperCase()}`,
        ),
      );
      if (interval.lower !== null) {
        for (const className of ["interval-halo", "interval"])
          chart.append(
            svg("line", {
              x1: x(interval.lower),
              y1: y,
              x2: x(interval.upper),
              y2: y,
              class: className,
            }),
          );
        for (const [v, align] of [
          [interval.lower, "end"],
          [interval.upper, "start"],
        ]) {
          chart.append(
            svg("line", {
              x1: x(v),
              y1: y - 7,
              x2: x(v),
              y2: y + 7,
              class: "cap",
            }),
          );
          chart.append(
            svg(
              "text",
              {
                x: x(v) + (align === "end" ? -5 : 5),
                y: y - 18,
                "text-anchor": align,
                class: "endpoint",
              },
              value(v),
            ),
          );
        }
      }
      if (estimate !== null) {
        chart.append(
          svg("circle", { cx: x(estimate), cy: y, r: 11, class: "point-halo" }),
        );
        chart.append(
          svg("circle", { cx: x(estimate), cy: y, r: 5, class: "estimate" }),
        );
      }
      chart.append(
        svg(
          "text",
          { x: 855, y: y + 8, class: "estimate-value" },
          value(estimate),
        ),
      );
    });
  }
  chart.setAttribute(
    "aria-label",
    !r.identifiable
      ? "Estimates withheld because target support is missing."
      : ["ips", "snips", "dr"]
          .map(
            (k) =>
              `${k.toUpperCase()} ${value(r.estimates[k])}, interval ${value(r.intervals[k].lower)} to ${value(r.intervals[k].upper)}`,
          )
          .join("; "),
  );
  $("rows").replaceChildren();
  for (const row of [...r.rows]
    .sort((a, b) => b.rawWeight - a.rawWeight || a.index - b.index)
    .slice(0, 10)) {
    const tr = document.createElement("tr");
    for (const text of [
      row.index,
      r.dataset.actions[row.action],
      value(row.reward),
      value(row.rawWeight),
      value(row.weight),
      value(row.dr),
    ]) {
      const td = document.createElement("td");
      td.textContent = text;
      tr.append(td);
    }
    $("rows").append(tr);
  }
}
function compute() {
  if (busy) return;
  let dataset;
  try {
    if ($("dataset").value.length > 2000000)
      throw Error("Dataset JSON is limited to two million characters.");
    dataset = JSON.parse($("dataset").value);
  } catch (error) {
    notice(error.message, true);
    return;
  }
  busy = true;
  dirty = true;
  controls();
  notice("Evaluating estimates and seeded bootstrap draws in a worker…");
  const worker = new Worker("/worker.js", { type: "module" });
  const finish = () => {
    worker.terminate();
    busy = false;
    controls();
  };
  worker.onmessage = ({ data }) => {
    if (data.error) {
      notice(data.error, true);
      finish();
      return;
    }
    result = data.result;
    dirty = false;
    render();
    notice(
      result.identifiable
        ? "Evaluation complete. Inspect overlap and weight concentration before interpreting estimates."
        : "Evaluation complete: missing support prevents policy-value identification.",
      !result.identifiable,
    );
    finish();
  };
  worker.onerror = () => {
    notice("Evaluation worker failed. Reload and try again.", true);
    finish();
  };
  worker.postMessage({
    dataset,
    settings: {
      clip: Number($("clip").value),
      replicates: Number($("replicates").value),
      seed: Number($("seed").value),
    },
  });
}
$("edit-open").onclick = () => $("edit-dialog").showModal();
$("edit-close").onclick = () => $("edit-dialog").close();
$("compute").onclick = compute;
$("preset").onchange = preset;
for (const id of ["clip", "replicates", "seed"]) $(id).oninput = invalidate;
$("dataset").oninput = () => {
  truth = null;
  invalidate();
};
function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type })),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$("export").onclick = () =>
  download(
    "reward-atlas-evidence.json",
    JSON.stringify({ ...result, simulationTruth: truth }, null, 2),
    "application/json",
  );
$("csv").onclick = () =>
  download(
    "reward-atlas-rows.csv",
    [
      "row,action,reward,behavior,target,raw_weight,used_weight,model,dr,unsupported",
      ...result.rows.map((r) =>
        [
          r.index,
          result.dataset.actions[r.action],
          r.reward,
          r.behavior,
          r.target,
          r.rawWeight,
          r.weight,
          r.model,
          r.dr,
          r.unsupported,
        ].join(","),
      ),
    ].join("\r\n"),
    "text/csv",
  );
preset();
