import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
const { outputText } = ts.transpileModule(readFileSync(new URL("../src/lib/navigation/view-history.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});
const exports = {};
vm.runInNewContext(outputText, { exports });
const { createViewHistory } = exports;
const initial = { view: "Assigned to me", category: "Any", status: "Active", priority: "Any" };
const snapshot = (view, extra = {}) => ({ ...initial, view, ...extra });
const equal = (actual, expected) => assert.equal(JSON.stringify(actual), JSON.stringify(expected));

function fixture() {
  let position = 0;
  const entries = [{ __NA: true, router: "preserved" }], listeners = new Set(), traversals = [], restored = [];
  const history = {
    get state() { return entries[position]; },
    pushState(value, _title, url) { assert.equal(url, "https://app.example/account"); entries.splice(++position); entries.push(value); },
    replaceState(value) { entries[position] = value; },
    go(delta) { traversals.push(position + delta); },
  };
  const port = { history, location: { pathname: "/account", href: "https://app.example/account" }, addEventListener(_name, listener) { listeners.add(listener); }, removeEventListener(_name, listener) { listeners.delete(listener); } };
  let blocked = false, pending = null;
  const callbacks = { restore(value) { restored.push(value); }, blocked: () => blocked, attempt(proceed) { pending = proceed; } };
  const api = createViewHistory(port, initial, callbacks, "fixture-owner");
  return { api, port, entries, restored, callbacks, get position() { return position; }, get pending() { return pending; }, block(value) { blocked = value; }, flush() {
    for (let count = 0; traversals.length; count++) {
      assert.ok(count < 10, "history must not loop");
      const next = traversals.shift();
      if (next < 0 || next >= entries.length) continue;
      position = next;
      for (const listener of listeners) listener({ state: history.state });
    }
  } };
}

test("Back returns Overview to Assigned and Forward restores Overview without creating duplicate entries", () => {
  const f = fixture();
  assert.equal(f.entries.length, 1, "launch does not add an exit-trapping sentinel");
  f.api.record(snapshot("Meeting overview"));
  assert.equal(f.entries.length, 2);
  assert.equal(f.port.history.state.__NA, true);
  assert.equal(f.port.history.state.router, "preserved");
  f.port.history.go(-1); f.flush(); equal(f.restored.at(-1), initial);
  f.api.record(initial); assert.equal(f.entries.length, 2);
  f.port.history.go(1); f.flush(); equal(f.restored.at(-1), snapshot("Meeting overview"));
});
test("category navigation has history while status and priority filters update the current entry", () => {
  const f = fixture();
  f.api.record(snapshot("All tasks", { category: "Sunday Service" }));
  f.api.record(snapshot("All tasks", { category: "Sunday Service", status: "All", priority: "High" }));
  assert.equal(f.entries.length, 2);
  f.port.history.go(-1); f.flush(); equal(f.restored.at(-1), initial);
  f.port.history.go(1); f.flush(); equal(f.restored.at(-1), snapshot("All tasks", { category: "Sunday Service", status: "All", priority: "High" }));
});
test("cancelled Back preserves a dirty screen and confirmed Back traverses exactly once", () => {
  const f = fixture(); f.api.record(snapshot("My profile")); f.block(true);
  f.port.history.go(-1); f.flush();
  assert.equal(f.position, 1); assert.equal(f.restored.length, 0); assert.equal(typeof f.pending, "function");
  // Staying on the screen leaves the restored browser position intact.
  f.port.history.go(-1); f.flush(); assert.equal(f.position, 1);
  f.pending(); f.pending(); f.flush();
  assert.equal(f.position, 0); equal(f.restored.at(-1), initial); assert.equal(f.restored.length, 1);
});
test("busy or open-modal Back restores the current history position without changing the view", () => {
  const f = fixture(); f.api.record(snapshot("Meeting overview")); f.block(true);
  f.callbacks.attempt = () => {}; // A busy action is ignored, or a modal closes.
  f.port.history.go(-1); f.flush(); assert.equal(f.position, 1); assert.equal(f.restored.length, 0);
  f.block(false); f.port.history.go(-1); f.flush(); equal(f.restored.at(-1), initial);
});
test("reload restores the saved in-document view and cleanup ignores later traversals", () => {
  const f = fixture(); f.api.record(snapshot("Needs help")); f.api.dispose();
  const reopened = createViewHistory(f.port, initial, f.callbacks, "different-owner");
  equal(f.restored.at(-1), snapshot("Needs help")); assert.equal(f.entries.length, 2);
  reopened.dispose(); const count = f.restored.length; f.port.history.go(-1); f.flush(); assert.equal(f.restored.length, count);
});
test("unrecognized history data cannot restore an arbitrary view or overwrite router state", () => {
  const f = fixture(); f.api.dispose();
  f.port.history.replaceState({ __NA: true, bgmViewHistory: { owner: "bad", path: "/account", index: 0, snapshot: { ...initial, view: "Execute task" } } });
  createViewHistory(f.port, initial, f.callbacks, "new-owner");
  assert.equal(f.restored.length, 0); assert.equal(f.port.history.state.__NA, true); equal(f.port.history.state.bgmViewHistory.snapshot, initial);
  equal(Object.keys(f.port.history.state.bgmViewHistory.snapshot).sort(), ["category", "priority", "status", "view"]);
});

test("fresh launch uses server selected Check in instead of a stale saved view", () => {
 const f=fixture();f.api.record(snapshot("Meeting overview"));f.api.dispose();
 const fresh=createViewHistory(f.port,snapshot("Check in"),f.callbacks,"fresh-launch",true);
 assert.equal(f.restored.length,0);equal(f.port.history.state.bgmViewHistory.snapshot,snapshot("Check in"));
 fresh.record(snapshot("Assigned to me"));f.port.history.go(-1);f.flush();equal(f.restored.at(-1),snapshot("Check in"));fresh.dispose();
});

test("Sunday Morning and Evening filters survive Back, Forward and reload without extra history entries", () => {
  const f = fixture();
  const selected = snapshot("Assigned to me", { priority: "Medium", sundayStatuses: { morning: "Completed", evening: "Overdue" } });
  f.api.record(selected);
  assert.equal(f.entries.length, 1, "section filters replace the current entry");
  f.api.record(snapshot("Meeting overview"));
  f.port.history.go(-1); f.flush(); equal(f.restored.at(-1), selected);
  f.api.record(selected); assert.equal(f.entries.length, 2);
  f.port.history.go(1); f.flush(); equal(f.restored.at(-1), snapshot("Meeting overview"));
  f.port.history.go(-1); f.flush(); f.api.dispose();
  const reopened = createViewHistory(f.port, initial, f.callbacks, "reload-owner");
  equal(f.restored.at(-1), selected); assert.equal(f.entries.length, 2);
  reopened.dispose();
});

test("Assigned and Sunday category history keep independent service selections", () => {
  const f = fixture();
  const assigned = snapshot("Assigned to me", { sundayStatuses: { morning: "Completed", evening: "Active" } });
  const category = snapshot("All tasks", { category: "Sunday Service", sundayStatuses: { morning: "All", evening: "Overdue" } });
  f.api.record(assigned); f.api.record(category);
  f.port.history.go(-1); f.flush(); equal(f.restored.at(-1), assigned);
  f.port.history.go(1); f.flush(); equal(f.restored.at(-1), category);
});

test("invalid service selections in stored navigation cannot restore an arbitrary filter", () => {
  for (const services of [null, [], { morning: "Execute task", evening: "Active" }, { morning: "Completed" }, { morning: "Active", evening: "All", taskRows: [] }]) {
    const f = fixture(); f.api.dispose();
    f.port.history.replaceState({ __NA: true, bgmViewHistory: { owner: "stored", path: "/account", index: 0, snapshot: snapshot("Assigned to me", { sundayStatuses: services }) } });
    const reopened = createViewHistory(f.port, initial, f.callbacks, "safe-owner");
    assert.equal(f.restored.length, 0); equal(f.port.history.state.bgmViewHistory.snapshot, initial);
    reopened.dispose();
  }
});
