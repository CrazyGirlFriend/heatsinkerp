import test from "node:test";
import assert from "node:assert/strict";
import { traceBatch } from "../src/batch-flow.js";
import { initialOrders } from "../src/data.js";

test("60 件和 40 件沿独立物料链流转，不按各班组批次号猜关联", () => {
  const order = initialOrders.find((o) => o.id === "a");
  const first = traceBatch(order.links, "a5");
  assert.deepEqual([...first.ids].sort(), ["a1", "a3", "a5", "a7"]);
  assert.equal(first.links.length, 3);
  const second = traceBatch(order.links, "a4");
  assert.deepEqual([...second.ids].sort(), ["a2", "a4", "a6", "a8"]);
  assert.equal(second.links.length, 3);
});

test("选中分料后的一批，追溯上游但不把兄弟批次高亮", () => {
  const links = [
    { from: "supply", to: "first" },
    { from: "supply", to: "second" },
    { from: "first", to: "inspection" },
  ];
  const flow = traceBatch(links, "first");
  assert.deepEqual([...flow.ids].sort(), ["first", "inspection", "supply"]);
  assert.deepEqual(flow.links.map((l) => [l.from, l.to]).sort(), [
    ["first", "inspection"],
    ["supply", "first"],
  ]);
});

test("选中共用上游时显示各分支；合料时显示所有明确的供料关联", () => {
  const links = [
    { from: "supply", to: "first" },
    { from: "supply", to: "second" },
    { from: "first", to: "merged" },
    { from: "second", to: "merged" },
  ];
  for (const id of ["supply", "merged"]) {
    const flow = traceBatch(links, id);
    assert.deepEqual([...flow.ids].sort(), [
      "first",
      "merged",
      "second",
      "supply",
    ]);
    assert.equal(flow.links.length, 4);
  }
});
