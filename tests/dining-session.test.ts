import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { DiningSession } from '../src/lib/dining-session.ts';
import { LiveDiningService } from '../src/lib/planner-live.ts';
import { PlannerModel } from '../src/lib/planner-model.ts';
import { PlannerController } from '../src/lib/planner-controller.ts';
import { addDays } from '../src/lib/planner-model.ts';
import { buildDiningRequest, buildReadRequest } from '../src/lib/transport.ts';
import { createMessageHandler } from '../src/lib/background-bridge.ts';
import { fake } from './fake.ts';

const current = '2026-10-17';
const next = '2026-10-24';
const opaque = (week, foodId) => `rr0fp10dd${week.replaceAll('-', '_')}ppp00-00dt2000_01_01ppp00-00me1dm1fo${foodId}ftf2000_01_01ppp00-00rest20`;
function fakeDining() {
  const state = { cursor: current, balance: 2000000, identity: 'fictional-test-account', wallets: [{ id: '1', name: 'Sample wallet' }],
    bookings: new Set<string>(), calls: [], failRead: false, rejectIds: new Set<string>(), loseResponse: false, wrongWeek: false,
    pause: null as null | ((operation: string) => unknown) };
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
  const transport = { async request(operation: string, parameters: Record<string, any> = {}) {
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
  const session = new DiningSession({ transport: fake(transport), bootstrapParser: html => JSON.parse(html), menuParser: html => JSON.parse(html) });
  return { state, session, foods };
}
const intent = (choice, desired) => ({ id: choice.id, desired, expectedReserved: choice.reserved,
  expectedPriceRials: choice.unitPriceRials, expectedPreviousCount: choice.previousCount });

async function connected() {
  const context = fakeDining();
  return { ...context, connection: await context.session.connect() };
}

test('write transport uses the observed form contract and keeps the probe read-only', () => {
  const record = `${opaque(next, 1)}tfco1pco0options||diet:0`;
  const request = buildDiningRequest('submit', { personGroupId: '10', restId: '20', firstEWalletId: '1', records: [record] });
  assert.equal(request.url, 'https://dining2.ut.ac.ir/Reserves/Index');
  const body = new URLSearchParams(String(request.init.body));
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
  assert.equal('identity' in connection, false);
  assert.equal('walletId' in connection, false);
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
  controller.showWeek(next);
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
  const handler = createMessageHandler(api, fake(session));
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

test('a forgotten background context reconnects before transmission and sends the save once', async () => {
  let connections = 0, writes = 0;
  const calls = [];
  const service = new LiveDiningService({ runtime: { async sendMessage(message) {
    calls.push(message.operation);
    if (message.operation === 'connect') return { ok: true, value: { token: `token-${++connections}`, accountTag: 'same-account',
      restaurants: [{ id: '10:20' }], writable: true } };
    if (message.parameters.token === 'token-1') return { ok: false, error: { code: 'reconnect-required', message: 'Context gone before HTTP.' } };
    writes++;
    return { ok: true, value: { complete: true, attempted: true, appliedIds: ['food'], balanceRials: 100 } };
  } } });
  await service.connect();
  await service.request('save', { token: service.token, restaurantId: '10:20', week: next, changes: [] });
  assert.equal(writes, 1);
  assert.deepEqual(calls, ['connect', 'save', 'connect', 'save']);
  assert.equal(service.token, 'token-2');
});

test('automatic context recovery refuses a different account and never retries uncertain writes', async () => {
  for (const code of ['reconnect-required', 'save-unknown']) {
    let connections = 0, saves = 0;
    const service = new LiveDiningService({ runtime: { async sendMessage(message) {
      if (message.operation === 'connect') return { ok: true, value: { token: 'token', accountTag: ++connections === 1 ? 'original' : 'different',
        restaurants: [{ id: '10:20' }], writable: true } };
      saves++;
      return { ok: false, error: { code, message: 'Predefined error.' } };
    } } });
    await service.connect();
    await assert.rejects(service.request('save', { token: service.token, restaurantId: '10:20' }), { code: code === 'reconnect-required' ? 'account-changed' : 'save-unknown' });
    assert.equal(saves, 1);
    assert.equal(connections, code === 'reconnect-required' ? 2 : 1);
  }
});

test('concurrent reads coalesce background recovery and both resume with the new handle', async () => {
  let connections = 0;
  const service = new LiveDiningService({ runtime: { async sendMessage(message) {
    if (message.operation === 'connect') {
      await new Promise(resolve => setTimeout(resolve, 0));
      return { ok: true, value: { token: `token-${++connections}`, accountTag: 'same', restaurants: [{ id: '10:20' }], writable: true } };
    }
    if (message.parameters.token === 'token-1') return { ok: false, error: { code: 'reconnect-required', message: 'Context gone.' } };
    return { ok: true, value: { week: next, choices: [], reservedIds: [] } };
  } } });
  await service.connect();
  await Promise.all([service.readMenu('10:20', next), service.readMenu('10:20', current)]);
  assert.equal(connections, 2);
});

test('a failed reconnect invalidates prior verification and reports only safe request metadata', async () => {
  let calls = 0;
  const service = new LiveDiningService({ runtime: { async sendMessage() {
    if (++calls === 1) return { ok: true, value: { token: 'private-token', writable: true, restaurants: [] } };
    return { ok: false, error: { code: 'redirect-required', message: 'Dining redirected the check.', diagnostic: {
      operation: 'bootstrap', path: '/Reserves', method: 'GET', status: 0,
      location: 'https://sso.example/?code=private-code', body: 'private-body', cookie: 'private-cookie',
    } } };
  } } });
  await service.connect();
  assert.equal(service.connectionReport().sessionVerified, true);
  await assert.rejects(service.connect(), { code: 'redirect-required' });
  const report = service.connectionReport();
  assert.equal(report.sessionVerified, false);
  assert.equal(service.writable, false);
  assert.equal(typeof report.sessionCheckedAt, 'number');
  assert.deepEqual(Object.fromEntries(Object.entries(report.checks.at(-1)!).filter(([key]) => key !== 'elapsedMs')), {
    operation: 'connect', result: 'redirect-required', path: '/Reserves', requestOperation: 'bootstrap', method: 'GET', status: 0,
  });
  assert.equal(JSON.stringify(report).includes('private-'), false);
});

test('failed background recovery cannot retain a prior verified session or permission to save', async () => {
  let connects = 0;
  const service = new LiveDiningService({ runtime: { async sendMessage(message) {
    if (message.operation === 'connect' && ++connects === 1) return { ok: true, value: { token: 'old-context', accountTag: 'same', writable: true, restaurants: [{ id: '10:20' }] } };
    return { ok: false, error: { code: message.operation === 'connect' ? 'network-error' : 'reconnect-required', message: 'Connection could not be verified.' } };
  } } });
  await service.connect();
  await assert.rejects(service.readMenu('10:20', next), { code: 'network-error' });
  assert.equal(service.connectionReport().sessionVerified, false);
  assert.equal(service.writable, false);
  assert.equal(typeof service.sessionCheckedAt, 'number');
});

function clientWithLostReply(context: ReturnType<typeof fakeDining>, { commit = true, loseContext = false, blockRecovery = false, emptyReply = false } = {}) {
  let saves = 0;
  const service = new LiveDiningService({ runtime: { async sendMessage(message) {
    const p = message.parameters;
    if (message.operation === 'connect') {
      if (saves && blockRecovery) throw new Error('Background is unavailable');
      return { ok: true, value: await context.session.connect() };
    }
    if (message.operation === 'menu') return { ok: true, value: await context.session.readMenu(p.token, p.restaurantId, p.week) };
    saves++;
    if (commit) await context.session.save(p.token, p.restaurantId, p.week, p.changes);
    if (loseContext) context.session.contexts.clear();
    if (emptyReply) return undefined;
    throw new Error('Could not establish connection. Receiving end does not exist.');
  } } });
  return { service, saves: () => saves, setRecoveryBlocked: (value: boolean) => { blockRecovery = value; } };
}

test('a lost extension reply after a server commit is verified without another save or charge', async () => {
  const context = fakeDining();
  const client = clientWithLostReply(context, { loseContext: true });
  await client.service.connect();
  const menu = await client.service.readMenu('10:20', next);
  const food = menu.choices[0];
  const result = await client.service.save('10:20', next, [{ choice: food, desired: true, revision: 1, ...intent(food, true) }]);
  assert.equal(result.complete, true);
  assert.deepEqual(result.appliedIds, [food.id]);
  assert.equal(result.balanceRials, 1750000);
  assert.equal(client.saves(), 1);
  assert.equal(context.state.calls.filter(call => call.operation === 'submit').length, 1);
});

test('a lost extension reply reads current unapplied records without resending them', async () => {
  const context = fakeDining();
  const client = clientWithLostReply(context, { commit: false });
  await client.service.connect();
  const menu = await client.service.readMenu('10:20', next);
  const food = menu.choices[0];
  const changes = [{ choice: food, desired: true, revision: 1, ...intent(food, true) }];
  const result = await client.service.save('10:20', next, changes);
  assert.equal(result.complete, false);
  assert.deepEqual(result.appliedIds, []);
  await client.service.reconcile('10:20', next, changes);
  assert.equal(client.saves(), 1);
  assert.equal(context.state.calls.filter(call => call.operation === 'submit').length, 0);
});

test('unavailable background and changed accounts cannot turn an unknown write into a confirmed save', async () => {
  for (const changedAccount of [false, true]) {
    const context = fakeDining();
    const client = clientWithLostReply(context);
    await client.service.connect();
    const menu = await client.service.readMenu('10:20', next);
    const food = menu.choices[0];
    if (changedAccount) context.state.identity = 'different-account';
    else context.state.pause = operation => { if (operation === 'bootstrap') throw new Error('background unavailable'); };
    await assert.rejects(client.service.save('10:20', next, [{ choice: food, desired: true, revision: 1, ...intent(food, true) }]), { code: 'save-unknown' });
    assert.equal(client.saves(), 1);
    assert.equal(client.service.writable, false);
  }
});

async function plannerWithLostReply(options: Parameters<typeof clientWithLostReply>[1] = {}) {
  const context = fakeDining();
  const client = clientWithLostReply(context, options);
  await client.service.connect();
  const model = new PlannerModel({ restaurants: client.service.restaurants, balanceRials: client.service.balanceRials, selectedIds: ['10:20'] });
  const failures = [];
  const controller = new PlannerController({ model, service: client.service, onError: failure => failures.push(failure) });
  controller.showWeek(next);
  await controller.idle();
  return { ...context, ...client, model, controller, failures, food: model.menus.get(`10:20|${next}`).choices[0] };
}

test('an empty reply after commit reconciles the planner instead of marking saved choices failed', async () => {
  const p = await plannerWithLostReply({ emptyReply: true });
  p.controller.choose(p.food);
  await p.controller.submit();
  assert.equal(p.model.saves.get('10:20').state, 'saved');
  assert.equal(p.model.changes().length, 0);
  assert.equal(p.model.balanceRials, 1750000);
  assert.equal(p.failures.length, 0);
  assert.equal(p.saves(), 1);
});

test('unknown saves keep their intents and Submit checks status even while writes are disabled', async () => {
  const p = await plannerWithLostReply({ blockRecovery: true, loseContext: true });
  p.controller.choose(p.food);
  await p.controller.submit();
  assert.equal(p.state.bookings.has(p.food.id), true); // Dining saved it despite the lost reply.
  assert.equal(p.model.saves.get('10:20').state, 'unknown');
  assert.equal(p.model.inflight.has(p.food.id), true);
  assert.equal(p.model.discard('10:20'), false);
  assert.equal(p.service.writable, false);
  assert.equal(p.failures[0].code, 'save-unknown');
  p.setRecoveryBlocked(false);
  await p.controller.submit(); // This must only read, not resend.
  await p.controller.idle();
  assert.equal(p.saves(), 1);
  assert.equal(p.model.saves.get('10:20').state, 'saved');
  assert.equal(p.model.inflight.size, 0);
  assert.equal(p.model.changes().length, 0);
  assert.equal(p.model.balanceRials, 1750000);
});

test('reversing intent during an unknown save survives reconciliation and is never autosubmitted', async () => {
  const p = await plannerWithLostReply({ blockRecovery: true });
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  p.state.pause = operation => operation === 'submit' ? gate : undefined;
  p.controller.choose(p.food);
  const saving = p.controller.submit();
  while (!p.state.calls.some(call => call.operation === 'submit')) await new Promise(resolve => setTimeout(resolve, 0));
  p.model.setDesired(p.food, false);
  release();
  await saving;
  assert.equal(p.model.drafts.get(p.food.id).desired, false);
  assert.equal(p.model.saves.get('10:20').state, 'unknown');
  p.setRecoveryBlocked(false);
  await p.controller.checkSave('10:20');
  await p.controller.idle();
  assert.equal(p.model.confirmed.has(p.food.id), true);
  assert.equal(p.model.drafts.get(p.food.id).desired, false);
  assert.equal(p.saves(), 1);
  assert.equal(p.model.delta(), -250000);
  await p.controller.submit(); // A separate explicit action sends the newer cancellation.
  assert.equal(p.saves(), 2);
  assert.equal(p.state.bookings.has(p.food.id), false);
  assert.equal(p.model.changes().length, 0);
  assert.equal(p.model.balanceRials, 2000000);
});

test('partial read-back commits accepted records and keeps only unapplied changes', async () => {
  const p = await plannerWithLostReply();
  const foods = p.model.menus.get(`10:20|${next}`).choices;
  for (const food of foods) p.controller.choose(food);
  p.state.rejectIds.add(foods[1].id);
  await p.controller.submit();
  assert.equal(p.saves(), 1);
  assert.equal(p.model.confirmed.has(foods[0].id), true);
  assert.deepEqual(p.model.changes().map(draft => draft.choice.id), [foods[1].id]);
  assert.equal(p.model.inflight.size, 0);
  assert.equal(p.model.saves.get('10:20').state, 'error');
  assert.equal(p.model.balanceRials, 1750000);
});

test('an unknown batch stops later weeks, and checking it cannot submit those later drafts', async () => {
  const p = await plannerWithLostReply({ blockRecovery: true });
  p.controller.choose(p.food);
  const later = addDays(next, 7);
  p.controller.showWeek(later);
  await p.controller.idle();
  const food = p.model.menus.get(`10:20|${later}`).choices[0];
  p.controller.choose(food);
  await p.controller.submit();
  assert.equal(p.saves(), 1);
  assert.equal(p.model.inflight.has(food.id), false);
  p.setRecoveryBlocked(false);
  await p.controller.checkSave('10:20');
  await p.controller.idle();
  assert.equal(p.saves(), 1);
  assert.deepEqual(p.model.changes().map(draft => draft.choice.id), [food.id]);
  assert.equal(p.model.confirmed.has(p.food.id), true);
});

test('a manual reconnect to another account cannot retarget an unresolved save', async () => {
  const p = await plannerWithLostReply({ blockRecovery: true });
  const originalAccount = p.service.accountTag;
  p.controller.choose(p.food);
  await p.controller.submit();
  p.setRecoveryBlocked(false);
  p.state.identity = 'another-account';
  await assert.rejects(p.service.connect(), { code: 'account-changed' });
  assert.equal(p.service.accountTag, originalAccount);
  await p.controller.checkSave('10:20');
  assert.equal(p.model.saves.get('10:20').state, 'unknown');
  assert.equal(p.model.confirmed.has(p.food.id), false);
  assert.equal(p.model.changes().length, 1);
  assert.equal(p.saves(), 1);
});
