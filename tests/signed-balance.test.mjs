import test from 'node:test';
import assert from 'node:assert/strict';
import { PlannerModel } from '../extension/lib/planner-model.mjs';
import { SignedBalanceLedger, signedBalanceTicks } from '../extension/lib/signed-balance.mjs';

const food = (id, priceRials, restaurantId = 'a', week = '2026-10-24') => ({
  id, name: id, restaurantId, week, date: week, mealId: id, priceRials, locked: false,
});
function setup(confirmed = [], balanceRials = 1000) {
  const model = new PlannerModel({ restaurants: ['a', 'b', 'c'].map(id => ({ id })), balanceRials,
    selectedIds: ['a', 'b', 'c'], activeId: 'a' });
  for (const choice of confirmed) model.confirmed.set(choice.id, choice);
  return { model, ledger: new SignedBalanceLedger() };
}
function complete(model, changes) {
  const cost = changes.reduce((sum, { choice, desired }) => sum
    + (Number(desired) - Number(model.confirmed.has(choice.id))) * choice.priceRials, 0);
  model.commit(changes, model.balanceRials - cost);
}
const segment = (view, id) => view.segments.find(entry => entry.choice.id === id);
const rectangle = entry => [entry.startRials, entry.endRials, entry.lane];
function stationary(before, after) {
  assert.equal(after.extentRials, before.extentRials);
  for (const entry of after.segments) assert.deepEqual(rectangle(entry), rectangle(segment(before, entry.choice.id)), entry.choice.id);
}

test('known paid reservations occupy the negative side without charging them twice', () => {
  const { model, ledger } = setup([food('old', 300)]);
  const view = ledger.update(model);
  assert.equal(view.reservedRials, 300);
  assert.equal(view.extentRials, 1300);
  assert.equal(view.projectedRials, 1000);
  assert.deepEqual(rectangle(segment(view, 'old')), [0, 300, 'full']);
  assert.equal(view.zeroFraction, 300 / 1300);
});

test('a confirmed purchase keeps every food rectangle fixed while zero and the round ruler move', () => {
  const { model, ledger } = setup([food('old', 300)]);
  ledger.update(model);
  model.setDesired(food('new', 200), true);
  const before = ledger.update(model);
  assert.equal(segment(before, 'new').state, 'adding');
  assert.equal(before.projectedRials, 800);
  const changes = model.capture('a');
  ledger.update(model);
  complete(model, changes);
  const after = ledger.update(model);
  stationary(before, after);
  assert.equal(segment(after, 'new').state, 'reserved');
  assert.equal(after.balanceRials, 800);
  assert.equal(after.reservedRials, 500);
  assert.equal(after.projectedRials, 800);
  const earlierZero = signedBalanceTicks(before, 900).find(tick => tick.value === 0);
  const laterZero = signedBalanceTicks(after, 900).find(tick => tick.value === 0);
  assert.equal(laterZero.fraction - earlierZero.fraction, 200 / 1300);
});

test('removing a middle reservation hatches it until refund, without moving surviving bars on commit', () => {
  const { model, ledger } = setup([food('first', 100), food('middle', 200), food('last', 300)]);
  ledger.update(model);
  model.setDesired(model.confirmed.get('middle'), false);
  const before = ledger.update(model);
  assert.equal(before.recoveryRials, 200);
  assert.equal(segment(before, 'middle').state, 'removing');
  assert.equal(segment(before, 'middle').endRials, before.reservedRials);
  complete(model, model.capture('a'));
  const after = ledger.update(model);
  stationary(before, after);
  assert.equal(segment(after, 'middle'), undefined);
  assert.equal(after.balanceRials, 1200);
  assert.equal(after.reservedRials, 400);
});

test('replacements expose gross spending and recovery, including equal-price swaps', () => {
  for (const price of [100, 300, 500]) {
    const old = food('old', 300);
    const { model, ledger } = setup([old]);
    ledger.update(model);
    model.setDesired(old, false);
    model.setDesired(food('replacement', price), true);
    const before = ledger.update(model);
    assert.equal(before.spendingRials, price);
    assert.equal(before.recoveryRials, 300);
    assert.deepEqual(rectangle(segment(before, 'old')), [0, 300, 'release']);
    assert.deepEqual(rectangle(segment(before, 'replacement')), [0, price, 'purchase']);
    complete(model, model.capture('a'));
    const after = ledger.update(model);
    stationary(before, after);
    assert.equal(after.reservedRials, price);
    assert.equal(after.balanceRials, 1300 - price);
  }
});

test('partial saves follow restaurant and week order; surviving bars stay below zero after each confirmation', () => {
  const week2 = '2026-10-31';
  const oldA = food('old-a', 300), laterA = food('old-a-later', 200, 'a', week2), oldB = food('old-b', 400, 'b');
  const { model, ledger } = setup([oldA, laterA, oldB]);
  ledger.update(model);
  for (const old of [oldA, laterA, oldB]) model.setDesired(old, false);
  for (const fresh of [food('new-a', 150), food('new-a-later', 450, 'a', week2), food('new-b', 600, 'b')]) model.setDesired(fresh, true);
  const a = model.capture('a');
  const b = model.capture('b');
  let before = ledger.update(model);
  assert.equal(segment(before, 'old-b').startRials, 0);
  for (const batch of [a.filter(draft => draft.choice.week !== week2), a.filter(draft => draft.choice.week === week2), b]) {
    complete(model, batch);
    const after = ledger.update(model);
    stationary(before, after);
    for (const entry of after.segments.filter(entry => entry.state !== 'adding')) assert.ok(entry.endRials <= after.reservedRials, entry.choice.id);
    before = after;
  }
  assert.equal(before.segments.length, 3);
  assert.equal(before.spendingRials + before.recoveryRials, 0);
});

test('rejection retains pending hatching and positions; undo removes intent immediately', () => {
  const { model, ledger } = setup();
  model.setDesired(food('new', 200), true);
  const before = ledger.update(model);
  const captured = model.capture('a');
  ledger.update(model);
  model.release(captured);
  const failed = ledger.update(model);
  stationary(before, failed);
  assert.equal(segment(failed, 'new').state, 'adding');
  model.discard('a');
  assert.equal(ledger.update(model).segments.length, 0);
  model.setDesired(food('again', 100), true);
  ledger.update(model);
  model.setDesired(food('again', 100), false);
  assert.equal(ledger.update(model).segments.length, 0);
});

test('undoing an in-flight addition preserves its block through purchase and later refund', () => {
  const { model, ledger } = setup();
  const fresh = food('new', 200);
  model.setDesired(fresh, true);
  const captured = model.capture('a');
  ledger.update(model);
  model.setDesired(fresh, false);
  const reversed = ledger.update(model);
  assert.equal(segment(reversed, 'new').state, 'removing');
  assert.equal(reversed.projectedRials, 1000);
  complete(model, captured);
  const paid = ledger.update(model);
  stationary(reversed, paid);
  assert.equal(paid.recoveryRials, 200);
  const refund = model.capture('a');
  ledger.update(model);
  complete(model, refund);
  assert.equal(ledger.update(model).segments.length, 0);
  assert.equal(model.balanceRials, 1000);
});

test('restoring an in-flight cancellation keeps the hatch through refund and repurchase', () => {
  const old = food('old', 300);
  const { model, ledger } = setup([old]);
  model.setDesired(old, false);
  const captured = model.capture('a');
  ledger.update(model);
  model.setDesired(old, true);
  const restored = ledger.update(model);
  assert.equal(segment(restored, 'old').state, 'adding');
  complete(model, captured);
  const refunded = ledger.update(model);
  stationary(restored, refunded);
  assert.equal(refunded.spendingRials, 300);
  complete(model, model.capture('a'));
  const paid = ledger.update(model);
  stationary(refunded, paid);
  assert.equal(segment(paid, 'old').state, 'reserved');
});

test('overspending retains the monetary scale; an empty wallet has finite positions', () => {
  const { model, ledger } = setup([food('old', 100)], 100);
  const before = ledger.update(model);
  model.setDesired(food('too-much', 500), true);
  const after = ledger.update(model);
  assert.equal(after.extentRials, before.extentRials);
  assert.equal(after.projectedRials, -400);
  assert.equal(segment(after, 'too-much').endRials, 600);
  const empty = setup([], 0);
  const view = empty.ledger.update(empty.model);
  assert.equal(view.zeroFraction, 0);
  assert.ok(signedBalanceTicks(view, 360).every(tick => Number.isFinite(tick.fraction)));
});

test('newly discovered paid bookings expand the known ledger; commits do not', () => {
  const { model, ledger } = setup([food('old', 100)]);
  const before = ledger.update(model);
  const found = food('discovered', 200, 'b');
  model.receiveMenu({ restaurantId: 'b', week: found.week, choices: [found], reservedIds: [found.id] });
  const after = ledger.update(model);
  assert.equal(after.extentRials, before.extentRials + 200);
  assert.ok(segment(after, found.id));
  assert.equal(after.balanceRials, before.balanceRials);
});

test('signed round ticks include zero and preserve minimum spacing at narrow and wide sizes', () => {
  const { model, ledger } = setup([food('old', 1_300_000)], 4_200_000);
  const view = ledger.update(model);
  for (const width of [260, 400, 900]) {
    const ticks = signedBalanceTicks(view, width);
    assert.ok(ticks.some(tick => tick.value === 0));
    assert.ok(ticks.every(tick => tick.value % 10_000 === 0 && tick.fraction >= 0 && tick.fraction <= 1));
    for (let i = 1; i < ticks.length; i++) assert.ok((ticks[i].fraction - ticks[i - 1].fraction) * width >= 72 - 1e-9);
  }
  const ticks = signedBalanceTicks(view, 900);
  assert.ok(ticks.some(tick => tick.value < 0));
  assert.ok(ticks.some(tick => tick.value > 0));
});
