import { ProbeError, buildReadRequest } from './transport.mjs';
import { parseRestaurants } from './parser.mjs';
import { parseLiveBootstrap, parseLiveMenu } from './live-parser.mjs';
import { addDays, weekOf } from './planner-model.mjs';

const COLORS = ['#47745c', '#537e8e', '#bb7352', '#948044', '#8272a6', '#ae6483', '#4f819f'];
const colorFor = id => COLORS[[...id].reduce((hash, character) => (hash * 31 + character.charCodeAt(0)) >>> 0, 0) % COLORS.length];
const validWeek = week => typeof week === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(week) && weekOf(week) === week;
const hashIdentity = async identity => identity ? [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(identity)))]
  .map(byte => byte.toString(16).padStart(2, '0')).join('') : null;

// Owns the complete cursor/navigation/write/read-back sequence across every extension tab.
export class DiningSession {
  constructor({ transport, bootstrapParser = parseLiveBootstrap, menuParser = parseLiveMenu }) {
    this.transport = transport;
    this.bootstrapParser = bootstrapParser;
    this.menuParser = menuParser;
    this.queue = Promise.resolve();
    this.contexts = new Map();
  }

  exclusive(action) {
    const result = this.queue.then(action);
    this.queue = result.catch(() => {});
    return result;
  }

  probeRead(operation, parameters) {
    buildReadRequest(operation, parameters); // The probe never acquires navigation or write access.
    return this.exclusive(() => this.transport.request(operation, parameters));
  }

  async bootstrap() {
    const result = await this.transport.request('bootstrap');
    return this.bootstrapParser(result.body);
  }

  connect() {
    return this.exclusive(async () => {
      const bootstrap = await this.bootstrap();
      if (!bootstrap.groups.length || !Number.isSafeInteger(bootstrap.balanceRials)) {
        throw new ProbeError('unexpected-response', 'Dining did not supply groups and a readable balance.');
      }
      const restaurants = [];
      for (const group of bootstrap.groups) {
        const result = await this.transport.request('restaurants', { personGroupId: group.id });
        for (const restaurant of parseRestaurants(result.body)) {
          const id = `${group.id}:${restaurant.id}`;
          restaurants.push({ id, restId: restaurant.id, personGroupId: group.id, group: group.name,
            name: restaurant.name, shortName: restaurant.name, color: colorFor(id), quotaGroup: null });
        }
      }
      if (!restaurants.length) throw new ProbeError('unexpected-response', 'No eligible restaurants were returned.');
      const token = crypto.randomUUID();
      const identityHash = await hashIdentity(bootstrap.identity);
      const writable = Boolean(identityHash && bootstrap.wallets.length === 1 && bootstrap.walletId === bootstrap.wallets[0].id);
      const writeReason = !identityHash ? 'Dining did not expose a recognizable account identity. Reservations are read-only.'
        : bootstrap.wallets.length !== 1 ? 'Multiple-wallet spending is not supported yet. Use dining to submit.' : '';
      this.contexts.set(token, { restaurants: new Map(restaurants.map(restaurant => [restaurant.id, restaurant])),
        identityHash, walletId: bootstrap.walletId, balanceRials: bootstrap.balanceRials, writable });
      while (this.contexts.size > 8) this.contexts.delete(this.contexts.keys().next().value);
      return { token, restaurants, balanceRials: bootstrap.balanceRials, writable, writeReason, accountTag: identityHash,
        walletName: bootstrap.wallets.find(wallet => wallet.id === bootstrap.walletId)?.name || '' };
    });
  }

  context(token, restaurantId) {
    const context = this.contexts.get(token);
    const restaurant = context?.restaurants.get(restaurantId);
    if (!restaurant) throw new ProbeError('reconnect-required', 'Reconnect dining before continuing.');
    return { context, restaurant };
  }

  async readAtWeek(restaurant, week) {
    if (!validWeek(week)) throw new ProbeError('invalid-request', 'Choose a valid Saturday-first week.');
    const parameters = { personGroupId: restaurant.personGroupId, restId: restaurant.restId };
    let response = await this.transport.request('menu', parameters);
    let menu = await this.menuParser(response.body, restaurant);
    let distance = Math.round((Date.parse(week) - Date.parse(menu.week)) / (7 * 86400000));
    if (Math.abs(distance) > 8) {
      response = await this.transport.request('current', parameters);
      menu = await this.menuParser(response.body, restaurant);
      distance = Math.round((Date.parse(week) - Date.parse(menu.week)) / (7 * 86400000));
    }
    if (Math.abs(distance) > 8) throw new ProbeError('week-range', 'Choose a week within eight weeks of the current menu.');
    while (menu.week !== week) {
      const direction = menu.week < week ? 1 : -1;
      const expected = addDays(menu.week, direction * 7);
      response = await this.transport.request(direction > 0 ? 'next' : 'previous', parameters);
      const moved = await this.menuParser(response.body, restaurant);
      if (moved.week !== expected) throw new ProbeError('week-mismatch', 'Dining did not return the requested week. Close other dining tabs and retry.');
      menu = moved;
    }
    return menu;
  }

  async balanceFor(menu, context) {
    const balance = menu.balanceRials ?? (await this.bootstrap()).balanceRials;
    if (!Number.isSafeInteger(balance) || balance < 0) throw new ProbeError('unexpected-response', 'Dining did not return a readable balance.');
    context.balanceRials = balance;
    return balance;
  }

  readMenu(token, restaurantId, week) {
    return this.exclusive(async () => {
      const { context, restaurant } = this.context(token, restaurantId);
      const menu = await this.readAtWeek(restaurant, week);
      menu.balanceRials = await this.balanceFor(menu, context);
      return menu;
    });
  }

  save(token, restaurantId, week, changes) {
    return this.exclusive(async () => {
      const { context, restaurant } = this.context(token, restaurantId);
      if (!context.writable) throw new ProbeError('read-only', 'This account is available for reading only.');
      if (!Array.isArray(changes) || !changes.length || changes.length > 70
          || new Set(changes.map(change => change?.id)).size !== changes.length
          || changes.some(change => typeof change?.id !== 'string' || typeof change.desired !== 'boolean'
            || typeof change.expectedReserved !== 'boolean' || !Number.isSafeInteger(change.expectedPriceRials)
            || change.expectedPriceRials < 0 || !Number.isSafeInteger(change.expectedPreviousCount)
            || change.expectedPreviousCount < 0 || change.expectedPreviousCount > 1)) {
        throw new ProbeError('invalid-request', 'Invalid reservation changes.');
      }
      const account = await this.bootstrap();
      if (await hashIdentity(account.identity) !== context.identityHash || account.walletId !== context.walletId) {
        throw new ProbeError('account-changed', 'The signed-in account or wallet changed. Reconnect before saving.');
      }
      const fresh = await this.readAtWeek(restaurant, week);
      const records = [];
      for (const change of changes) {
        const choice = fresh.choices.find(choice => choice.id === change.id);
        if (!choice) throw new ProbeError('stale-menu', 'A selected food is no longer on this menu. Refresh it before saving.');
        if (choice.reserved === change.desired) continue; // Reconcile a lost response without repeating a purchase.
        if (choice.locked || choice.unitPriceRials !== change.expectedPriceRials
            || choice.reserved !== change.expectedReserved || choice.previousCount !== change.expectedPreviousCount) {
          throw new ProbeError('stale-menu', 'A food, price, quantity, or deadline changed. Refresh this restaurant before saving.');
        }
        records.push(`${choice.serverKey}${change.desired ? 't' : 'f'}fco1pco${choice.previousCount}options||diet:0`);
      }
      let submitted = false;
      if (records.length) {
        try {
          await this.transport.request('submit', { personGroupId: restaurant.personGroupId, restId: restaurant.restId,
            firstEWalletId: context.walletId, records });
          submitted = true;
        } catch { /* An HTTP error may follow a successful write. Read-back decides the result. */ }
      }
      let actual;
      try {
        actual = records.length ? await this.readAtWeek(restaurant, week) : fresh;
        actual.balanceRials = await this.balanceFor(actual, context);
      } catch {
        throw new ProbeError('save-unknown', 'The result could not be verified. Your choices are kept. Refresh this restaurant before retrying.');
      }
      const appliedIds = changes.filter(change => actual.choices.some(choice => choice.id === change.id && choice.reserved === change.desired)).map(change => change.id);
      return { menu: actual, balanceRials: actual.balanceRials, appliedIds, attempted: records.length > 0, complete: appliedIds.length === changes.length,
        message: appliedIds.length === changes.length ? 'Reservations verified with dining.'
          : submitted ? 'Dining did not accept every change. Your remaining choices are kept.'
            : 'The save was not confirmed. Your remaining choices are kept.' };
    });
  }
}
