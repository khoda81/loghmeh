import test from 'node:test';
import assert from 'node:assert/strict';
import { DiningSession } from '../extension/lib/dining-session.mjs';
import { LiveDiningService } from '../extension/lib/planner-live.mjs';
import { PlannerModel } from '../extension/lib/planner-model.mjs';
import { PlannerController } from '../extension/lib/planner-controller.mjs';
import { addDays } from '../extension/lib/planner-model.mjs';
import { buildDiningRequest, buildReadRequest } from '../extension/lib/transport.mjs';
import { createMessageHandler } from '../extension/lib/background-bridge.mjs';

const current = '2026-10-17';
const next = '2026-10-24';
const opaque = (week, foodId) => `rr0fp10dd${week.replaceAll('-', '_')}ppp00-00dt2000_01_01ppp00-00me1dm1fo${foodId}ftf2000_01_01ppp00-00rest20`;
function fakeDining() {
  const state = { cursor: current, balance: 2000000, identity: 'fictional-test-account', wallets: [{ id: '1', name: 'Sample wallet' }],
    bookings: new Set(), calls: [], failRead: false, rejectIds: new Set(), loseResponse: false };
  const foods = (restaurantId, week) => [1, 2].map(foodId => {
    const id = `${restaurantId}:${week}:${foodId}`;
    const reserved = state.bookings.has(id);
    return { id, restaurantId, week, date: week, mealId: String(foodId), name: `Sample ${foodId}`,
      unitPriceRials: foodId * 250000, priceRials: foodId * 250000,
      serverKey: opaque(week, foodId), count: 0, previousCount: reserved ? 1 : 0, reserved, locked: false };
  });
  const menu = parameters => {
    const restaurantId = `10:${parameters.restId}`;
    const choices = foods(restaurantId, state.cursor);
    return { restaurantId, week: state.cursor, choices, reservedIds: choices.filter(food => food.reserved).map(food => food.id),
      published: true, balanceRials: state.balance };
  };
  const transport = { async request(operation, parameters = {}) {
    state.calls.push({ operation, parameters });
    if (state.pause) await state.pause(operation);
    if (operation === 'bootstrap') return { body: JSON.stringify({ groups: [{ id: '10', name: 'Sample group' }],
      balanceRials: state.balance, identity: state.identity, wallets: state.wallets, walletId: state.wallets[0]?.id }) };
    if (operation === 'restaurants') return { body: '[{"id":20,"value":"Place A"},{"id":21,"value":"Place B"}]' };
    if (operation === 'current') state.cursor = current;
    if (operation === 'next') state.cursor = addDays(state.cursor, state.wrongWeek ? 14 : 7);
    if (operation === 'previous') state.cursor = addDays(state.cursor, -7);
    if (operation === 'submit') {
      const restaurantId = `10:${parameters.restId}`;
      for (const record of parameters.records) {
        const food = foods(restaurantId, state.cursor).find(food => record.startsWith(food.serverKey));
        if (!food || state.rejectIds.has(food.id)) continue;
        const desired = record.slice(food.serverKey.length).startsWith('t');
        if (desired !== food.reserved) state.balance += desired ? -food.priceRials : food.priceRials;
        if (desired) state.bookings.add(food.id); else state.bookings.delete(food.id);
      }
      if (state.loseResponse) throw new Error('Response lost after server commit');
      return { body: '<arbitrary result script that is never executed>' };
    }
    if (state.failRead) throw new Error('Read failed');
    return { body: JSON.stringify(menu(parameters)) };
  } };
  const session = new DiningSession({ transport, bootstrapParser: JSON.parse, menuParser: JSON.parse });
  return { state, session, foods };
}
const intent = (choice, desired) => ({ id: choice.id, desired, expectedReserved: choice.reserved,
  expectedPriceRials: choice.unitPriceRials, expectedPreviousCount: choice.previousCount });

async function connected() {
  const context = fakeDining();
  context.connection = await context.session.connect();
  return context;
}

test('write transport uses the observed form contract and keeps the probe read-only', () => {
  const record = `${opaque(next, 1)}tfco1pco0options||diet:0`;
  const request = buildDiningRequest('submit', { personGroupId: '10', restId: '20', firstEWalletId: '1', records: [record] });
  assert.equal(request.url, 'https://dining2.ut.ac.ir/Reserves/Index');
  const body = new URLSearchParams(request.init.body);
  assert.deepEqual(body.getAll('DataId[]'), [record]);
  assert.equal(body.get('type'), 'Index');
  assert.equal(request.init.credentials, 'include');
  assert.throws(() => buildReadRequest('submit', {}), /only supports reading/u);
  assert.throws(() => buildDiningRequest('submit', { personGroupId: '10', restId: '20', firstEWalletId: '1', records: ['not-a-record'] }));
  assert.throws(() => buildDiningRequest('https://other.invalid', {}));
});

test('connect discovers the current catalogue without assuming demo entitlements', async () => {
  const { connection } = await connected();
  assert.equal(connection.restaurants.length, 2);
  assert.ok(connection.restaurants.every(restaurant => restaurant.quotaGroup === null));
  assert.equal(connection.writable, true);
  assert.equal(connection.identity, undefined);
  assert.equal(connection.walletId, undefined);
});

test('week reads verify the actual cursor and do not advance again when already at the target', async () => {
  const { session, connection, state } = await connected();
  const first = await session.readMenu(connection.token, '10:20', next);
  const second = await session.readMenu(connection.token, '10:21', next);
  assert.equal(first.week, next);
  assert.equal(second.week, next);
  assert.equal(state.calls.filter(call => call.operation === 'next').length, 1);
});

test('an unexpected week response is rejected rather than mislabeled or retried', async () => {
  const { session, connection, state } = await connected();
  state.wrongWeek = true;
  await assert.rejects(session.readMenu(connection.token, '10:20', next), { code: 'week-mismatch' });
  assert.equal(state.calls.filter(call => call.operation === 'next').length, 1);
});

test('navigation, save read-back, and the separate probe share one exclusive queue', async () => {
  const { session, connection, state } = await connected();
  state.calls = [];
  let release;
  const hold = new Promise(resolve => { release = resolve; });
  state.pause = operation => operation === 'next' ? hold : undefined;
  const reading = session.readMenu(connection.token, '10:20', next);
  const probe = session.probeRead('bootstrap', {});
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(state.calls.map(call => call.operation), ['menu', 'next']);
  release();
  await Promise.all([reading, probe]);
  assert.deepEqual(state.calls.map(call => call.operation), ['menu', 'next', 'bootstrap']);
});

test('saving preserves the opaque token and confirms actual state and balance by reading back', async () => {
  const { session, connection, state } = await connected();
  const menu = await session.readMenu(connection.token, '10:20', next);
  const selected = menu.choices[0];
  const result = await session.save(connection.token, '10:20', next, [intent(selected, true)]);
  assert.equal(result.complete, true);
  assert.equal(result.balanceRials, 1750000);
  assert.deepEqual(result.appliedIds, [selected.id]);
  const write = state.calls.find(call => call.operation === 'submit');
  assert.deepEqual(write.parameters.records, [`${selected.serverKey}tfco1pco0options||diet:0`]);
  assert.equal(state.calls.at(-1).operation, 'menu');
});

test('HTTP success with a rejected business change retains an unapplied draft', async () => {
  const { session, connection, state } = await connected();
  const menu = await session.readMenu(connection.token, '10:20', next);
  state.rejectIds.add(menu.choices[0].id);
  const result = await session.save(connection.token, '10:20', next, [intent(menu.choices[0], true)]);
  assert.equal(result.complete, false);
  assert.deepEqual(result.appliedIds, []);
  assert.equal(result.balanceRials, 2000000);
});

test('a lost save response is reconciled; retry never purchases an already reserved meal again', async () => {
  const { session, connection, state } = await connected();
  const menu = await session.readMenu(connection.token, '10:20', next);
  const change = intent(menu.choices[0], true);
  state.loseResponse = true;
  const first = await session.save(connection.token, '10:20', next, [change]);
  const second = await session.save(connection.token, '10:20', next, [change]);
  assert.ok(first.complete && second.complete);
  assert.equal(state.calls.filter(call => call.operation === 'submit').length, 1);
  assert.equal(state.balance, 1750000);
});

test('unreadable post-save state reports an unknown outcome without repeating the write', async () => {
  const { session, connection, state } = await connected();
  const menu = await session.readMenu(connection.token, '10:20', next);
  state.pause = operation => { if (operation === 'submit') state.failRead = true; };
  await assert.rejects(session.save(connection.token, '10:20', next, [intent(menu.choices[0], true)]), { code: 'save-unknown' });
  assert.equal(state.calls.filter(call => call.operation === 'submit').length, 1);
});

test('account, price, and quantity changes stop a write before transmission', async () => {
  for (const mutate of [
    context => { context.state.identity = 'another-fictional-account'; },
    (_context, change) => { change.expectedPriceRials++; },
    (_context, change) => { change.expectedPreviousCount = 1; },
  ]) {
    const context = await connected();
    const menu = await context.session.readMenu(context.connection.token, '10:20', next);
    const change = intent(menu.choices[0], true);
    mutate(context, change);
    await assert.rejects(context.session.save(context.connection.token, '10:20', next, [change]));
    assert.equal(context.state.calls.filter(call => call.operation === 'submit').length, 0);
  }
});

test('the UI controller adopts partial live results and retains only the unaccepted intent', async () => {
  const context = fakeDining();
  const api = { runtime: { async sendMessage(message) {
    try {
      const { token, restaurantId, week, changes } = message.parameters;
      const value = message.operation === 'connect' ? await context.session.connect()
        : message.operation === 'menu' ? await context.session.readMenu(token, restaurantId, week)
          : await context.session.save(token, restaurantId, week, changes);
      return { ok: true, value };
    } catch (error) { return { ok: false, error: { code: error.code, message: error.message } }; }
  } } };
  const service = new LiveDiningService(api);
  const connection = await service.connect();
  const model = new PlannerModel({ restaurants: connection.restaurants, balanceRials: connection.balanceRials, selectedIds: ['10:20'], activeId: '10:20' });
  const controller = new PlannerController({ model, service });
  controller.ensureWeek(next);
  await controller.idle();
  const choices = [...model.menus.values()][0].choices;
  for (const choice of choices) model.setDesired(choice, true);
  context.state.rejectIds.add(choices[1].id);
  await controller.submit();
  await controller.idle();
  assert.equal(model.confirmed.size, 1);
  assert.equal(model.changes().length, 1);
  assert.equal(model.changes()[0].choice.id, choices[1].id);
  assert.equal(model.balanceRials, 1750000);
  assert.equal(model.saves.get('10:20').state, 'error');
  // The newly confirmed choice has authoritative quantity/reservation metadata.
  model.discard('10:20');
  model.setDesired(model.confirmed.get(choices[0].id), false);
  await controller.submit();
  await controller.idle();
  assert.equal(model.confirmed.size, 0);
  assert.equal(model.balanceRials, 2000000);
});

test('background routing accepts writes only from this extension planner page', async () => {
  const api = { runtime: { id: 'test-extension', getURL: path => `moz-extension://test/${path}` }, permissions: { contains: async () => true } };
  let writes = 0;
  const session = { save: async () => { writes++; return {}; }, probeRead: async operation => { buildReadRequest(operation); } };
  const handler = createMessageHandler(api, session);
  const message = { type: 'loghmeh:planner', operation: 'save', parameters: { token: 'x', restaurantId: 'x', week: next, changes: [] } };
  for (const sender of [
    { id: 'other', url: api.runtime.getURL('planner.html') },
    { id: api.runtime.id, url: 'https://dining2.ut.ac.ir/Reserves' },
    { id: api.runtime.id, url: api.runtime.getURL('probe.html') },
    { id: api.runtime.id, url: api.runtime.getURL('planner.html.evil') },
  ]) assert.equal(handler(message, sender, () => {}), false);
  assert.equal(writes, 0);
  await new Promise(resolve => handler(message, { id: api.runtime.id, url: api.runtime.getURL('planner.html') + '?demo=1' }, resolve));
  assert.equal(writes, 1);
});

test('multiple wallets and unrecognized accounts remain read-only', async () => {
  for (const mutate of [
    state => { state.wallets.push({ id: '2', name: 'Other sample wallet' }); },
    state => { state.identity = null; },
  ]) {
    const { session, state } = fakeDining();
    mutate(state);
    const connection = await session.connect();
    assert.equal(connection.writable, false);
    await assert.rejects(session.save(connection.token, '10:20', next, []), { code: 'read-only' });
    assert.equal(state.calls.filter(call => call.operation === 'submit').length, 0);
  }
});

test('live diagnostics omit all identity, wallet, food, token, and balance data', async () => {
  const service = new LiveDiningService({ runtime: {
    getManifest: () => ({ version: '0.4.0' }),
    sendMessage: async message => ({ ok: true, value: message.operation === 'connect'
      ? { token: 'private-token', accountTag: 'private-identity', balanceRials: 987654321, walletId: 'private-wallet', writable: true,
        restaurants: [{ id: 'private-restaurant', name: 'private-place-name' }] }
      : { week: next, balanceRials: 987654321, choices: [{ id: 'private-food-id', name: 'private-food-name', locked: false }], reservedIds: ['private-food-id'] } }),
  } });
  await service.connect();
  await service.readMenu('private-restaurant', next);
  const report = JSON.stringify(service.connectionReport());
  for (const sensitive of ['private-', '987654321', 'walletId', 'accountTag', 'balanceRials']) assert.equal(report.includes(sensitive), false);
  assert.equal(service.connectionReport().menuVerified, true);
  assert.equal(service.connectionReport().writeVerified, false);
});
