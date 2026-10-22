import test from 'node:test';
import assert from 'node:assert/strict';
import { PlannerModel, addDays, weekOf, tehranToday, menuKey } from '../extension/lib/planner-model.mjs';
import { RESTAURANTS, DemoDiningService } from '../extension/lib/planner-demo.mjs';
import { PlannerController } from '../extension/lib/planner-controller.mjs';

const today = '2026-10-22';
const week = '2026-10-24';
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
function setup({ service: serviceOptions = {}, selectedIds = ['kooy', 'garden'] } = {}) {
  const service = new DemoDiningService({ today, wait: async () => {}, ...serviceOptions });
  const model = new PlannerModel({ restaurants: RESTAURANTS, balanceRials: service.balanceRials, selectedIds, activeId: selectedIds[0] });
  const controller = new PlannerController({ model, service });
  return { model, service, controller };
}
async function load(context, targetWeek = week) {
  context.controller.ensureWeek(targetWeek);
  await context.controller.idle();
}
function choice(context, restaurantId = 'kooy', day = 1, targetWeek = week) {
  return context.model.menus.get(menuKey(restaurantId, targetWeek)).choices.find(item => item.date === addDays(targetWeek, day) && item.mealId === '1');
}

test('calendar uses Tehran dates and Saturday weeks', () => {
  assert.equal(tehranToday(new Date('2026-10-23T21:00:00Z')), '2026-10-24');
  assert.equal(weekOf('2026-10-23'), '2026-10-17');
  assert.equal(weekOf('2026-10-24'), '2026-10-24');
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
});

test('existing reservations are not charged twice; refreshing a menu preserves the draft', async () => {
  const context = setup();
  await load(context);
  assert.equal(context.model.confirmed.size, 1);
  assert.equal(context.model.delta(), 0);
  const food = choice(context);
  context.model.choose(food);
  assert.equal(context.model.delta(), food.priceRials);
  context.model.receiveMenu(await context.service.readMenu('kooy', week));
  assert.ok(context.model.bookings().some(item => item.id === food.id));
  assert.equal(context.model.changes().length, 1);
});

test('switching restaurants submits the outgoing draft and leaves the new restaurant editable', async () => {
  const context = setup();
  await load(context);
  const food = choice(context);
  context.controller.choose(food);
  context.controller.select('garden');
  assert.equal(context.model.activeId, 'garden');
  assert.ok(context.controller.saveJobs.has('kooy'));
  const extra = choice(context, 'garden');
  context.controller.choose(extra);
  await context.controller.idle();
  assert.ok(context.model.confirmed.has(food.id));
  assert.ok(context.model.drafts.has(extra.id));
  assert.equal(context.model.bookings().filter(item => item.date === food.date && item.mealId === food.mealId).length, 2);
  assert.equal(context.model.balanceRials, 4_200_000 - food.priceRials);
});

test('a rejected save retains the draft and balance; retry only happens on an explicit action', async () => {
  const context = setup();
  await load(context);
  context.controller.choose(choice(context));
  context.service.failNextSave = true;
  let calls = 0;
  const save = context.service.save.bind(context.service);
  context.service.save = (...args) => { calls++; return save(...args); };
  await context.controller.submit('kooy');
  await context.controller.idle();
  assert.equal(context.model.saves.get('kooy').state, 'error');
  assert.equal(context.model.changes('kooy').length, 1);
  assert.equal(context.model.balanceRials, 4_200_000);
  assert.equal(calls, 1);
  context.controller.retry('kooy');
  await context.controller.idle();
  assert.equal(calls, 2);
  assert.equal(context.model.changes('kooy').length, 0);
});

test('edits during a save survive its response, including undoing an in-flight addition', async () => {
  const context = setup();
  await load(context);
  let release;
  context.service.wait = () => new Promise(resolve => { release = resolve; });
  const food = choice(context);
  context.controller.choose(food);
  const saving = context.controller.submit('kooy');
  await tick();
  context.controller.removeChoice(food);
  assert.equal(context.model.drafts.get(food.id).desired, false);
  release();
  await saving;
  await context.controller.idle();
  assert.ok(context.model.confirmed.has(food.id));
  assert.equal(context.model.drafts.get(food.id).desired, false);
  assert.equal(context.model.delta('kooy'), -food.priceRials);
  context.service.wait = async () => {};
  await context.controller.submit('kooy');
  await context.controller.idle();
  assert.ok(!context.model.confirmed.has(food.id));
  assert.equal(context.model.balanceRials, 4_200_000);
});

test('restaurant requests are serialized and limited to the selected places', async () => {
  const context = setup();
  let running = 0;
  let maximum = 0;
  const called = [];
  const read = context.service.readMenu.bind(context.service);
  context.service.readMenu = async (id, targetWeek) => {
    running++;
    maximum = Math.max(maximum, running);
    called.push(id);
    await tick();
    const result = await read(id, targetWeek);
    running--;
    return result;
  };
  context.controller.ensureWeek(week);
  context.controller.ensureWeek(week);
  await context.controller.idle();
  assert.equal(maximum, 1);
  assert.deepEqual(called, ['kooy', 'garden']);
  context.controller.ensureWeek(addDays(week, 7));
  context.controller.hideWeek(addDays(week, 7));
  await context.controller.idle();
  assert.equal(called.length, 2);
});

test('known entitlement conflicts and insufficient balance block writes without erasing choices', async () => {
  const context = setup({ selectedIds: ['kooy', 'engineering', 'garden'] });
  await load(context);
  context.controller.choose(choice(context));
  context.controller.choose(choice(context, 'engineering'));
  assert.equal(context.model.conflicts().length, 1);
  await context.controller.submit('engineering');
  assert.equal(context.model.changes('engineering').length, 1);
  assert.match(context.model.saves.get('engineering').message, /Only one student meal/);
  context.model.discard('engineering');
  assert.equal(context.model.conflicts().length, 0);
  for (let day = 1; day <= 4; day++) context.controller.choose(choice(context, 'garden', day));
  assert.ok(context.model.balanceRials - context.model.delta() < 0);
  await context.controller.submit('garden');
  assert.equal(context.model.changes('garden').length, 4);
  assert.equal(context.model.balanceRials, 4_200_000);
});

test('a wrong-week response is rejected without contaminating the calendar', async () => {
  const context = setup({ selectedIds: ['kooy'] });
  const read = context.service.readMenu.bind(context.service);
  context.service.readMenu = (id, targetWeek) => read(id, addDays(targetWeek, 7));
  await load(context);
  assert.equal(context.model.menus.size, 0);
  assert.equal(context.model.loads.get(menuKey('kooy', week)).state, 'error');
});

test('today’s reservation scan continues while planning a different week', async () => {
  const context = setup();
  const current = weekOf(today);
  context.controller.ensureWeek(current, true);
  context.controller.hideWeek(current);
  await context.controller.idle();
  for (const id of context.model.selectedIds) assert.equal(context.model.loads.get(menuKey(id, current)).state, 'ready');
});

test('failure in a later week preserves earlier successes and the remaining draft', async () => {
  const context = setup({ service: { today: '2026-10-17' }, selectedIds: ['kooy'] });
  await load(context, '2026-10-17');
  await load(context, week);
  const first = choice(context, 'kooy', 2, '2026-10-17');
  const second = choice(context, 'kooy', 1, week);
  context.model.choose(first);
  context.model.choose(second);
  let calls = 0;
  const save = context.service.save.bind(context.service);
  context.service.save = (...args) => { calls++; if (calls === 2) context.service.failNextSave = true; return save(...args); };
  await context.controller.submit('kooy');
  await context.controller.idle();
  assert.ok(context.model.confirmed.has(first.id));
  assert.ok(!context.model.drafts.has(first.id));
  assert.ok(context.model.drafts.has(second.id));
  assert.equal(context.model.inflight.size, 0);
  assert.equal(context.model.balanceRials, 4_200_000 - first.priceRials);
  assert.equal(context.model.saves.get('kooy').state, 'error');
});

test('local state restores restaurant colors, confirmed menus, and unsubmitted intent', async () => {
  const context = setup();
  await load(context);
  context.model.choose(choice(context, 'garden'));
  const restored = new PlannerModel({ restaurants: RESTAURANTS, balanceRials: context.model.balanceRials, ...JSON.parse(JSON.stringify(context.model.exportState())) });
  assert.equal(restored.changes().length, 1);
  assert.equal(restored.delta(), context.model.delta());
  assert.deepEqual(restored.selectedIds, context.model.selectedIds);
  assert.equal(restored.confirmed.size, context.model.confirmed.size);
  assert.equal(restored.loads.size, 0); // Cached menus still need a fresh read.
});
