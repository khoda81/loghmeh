import { PlannerModel, MEALS, addDays, weekOf, tehranToday, menuKey, slotKey } from './lib/planner-model.mjs';
import { SignedBalanceLedger, signedBalanceTicks } from './lib/signed-balance.mjs';
import { DemoDiningService, RESTAURANTS } from './lib/planner-demo.mjs';
import { PlannerController } from './lib/planner-controller.mjs';
import { LiveDiningService } from './lib/planner-live.mjs';
import { createExtensionClient } from './lib/client.mjs';

// The calendar restores a week explicitly; browser scroll restoration must not race it.
history.scrollRestoration = 'manual';

const $ = id => document.getElementById(id);
const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
const money = rials => (rials / 10).toLocaleString('en-US', { maximumFractionDigits: 1 });
const today = tehranToday();
const currentWeek = weekOf(today);
const nextWeek = addDays(currentWeek, 7);
const storageKey = `loghmeh:planner-demo:v1:${today}`;
const extensionApi = globalThis.browser ?? globalThis.chrome;
const isExtension = Boolean(extensionApi?.runtime?.id);
const isLive = isExtension && new URLSearchParams(location.search).get('demo') !== '1';
const sessionClient = isExtension ? createExtensionClient(extensionApi) : null;
let saved;
try { if (!isLive) saved = JSON.parse(localStorage.getItem(storageKey)); } catch { /* Local persistence is optional. */ }
const service = isLive ? new LiveDiningService(extensionApi) : new DemoDiningService({ today, saved: saved?.server });
let restaurants = isLive ? [] : RESTAURANTS;
let model;
let controller;
let accountTag;
let connecting = false;
const faDate = new Intl.DateTimeFormat('fa-IR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const shortFaDate = new Intl.DateTimeFormat('fa-IR', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const englishDate = new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const weekday = new Intl.DateTimeFormat('en', { weekday: 'short', timeZone: 'UTC' });
const fullWeekday = new Intl.DateTimeFormat('en', { weekday: 'long', timeZone: 'UTC' });
const asDate = day => new Date(day + 'T12:00:00Z');
const mealName = id => MEALS.find(meal => meal.id === id)?.name || id;
const hour = Number(new Intl.DateTimeFormat('en', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Asia/Tehran' }).format(new Date()));
const currentMeal = isLive ? null : hour < 16 ? '1' : '3'; // Live serving windows are not assumed.
const weekNodes = new Map();
const ledger = new SignedBalanceLedger();
const segmentNodes = new Map();
const tickNodes = new Map();
let ledgerView;
let toastTimer;
let lastMessage = '';
let weekObserver;
let scrollDirection = 'down';
let lastScroll = window.scrollY;
let addingWeek = false;
let initialJump = true;
let allowPastLoad = false;
let modalScrollY = 0;
let touchY = 0;

function persist() {
  try {
    if (isLive) localStorage.setItem('loghmeh:live:palette:v1', JSON.stringify({ selectedIds: model.selectedIds, activeId: model.activeId }));
    else localStorage.setItem(storageKey, JSON.stringify({ model: model.exportState(), server: service.exportState() }));
  }
  catch { /* State remains usable in memory if storage is disabled or full. */ }
}

function statusFor(id) {
  const save = model.saves.get(id);
  const loads = [...model.loads.values()].filter(load => load.restaurantId === id);
  const pending = loads.filter(load => ['queued', 'loading'].includes(load.state));
  const count = model.changes(id).length;
  if (save?.state === 'error') return { text: 'Not saved', error: true, title: save.message };
  if (['queued', 'saving'].includes(save?.state)) return { text: save.state === 'queued' ? 'Save queued' : 'Saving…', busy: true };
  if (loads.some(load => load.state === 'error')) return { text: 'Load failed', error: true, title: 'Retry the menu request.' };
  if (pending.length) return { text: `${pending.some(load => load.state === 'loading') ? 'Loading' : 'Queued'}${count ? ` · ${count} ${count === 1 ? 'change' : 'changes'}` : '…'}`, busy: true };
  if (count) return { text: `${count} ${count === 1 ? 'change' : 'changes'}` };
  return { text: save?.state === 'saved' ? 'Saved' : 'Ready' };
}

function renderPalette() {
  const focused = document.activeElement?.dataset.focusKey;
  const tokens = model.selectedIds.map(id => {
    const restaurant = model.restaurants.get(id);
    const status = statusFor(id);
    const token = el('div', `place-token${id === model.activeId ? ' active' : ''}${status.error ? ' has-error' : ''}`);
    token.style.setProperty('--restaurant-color', restaurant.color);
    const button = el('button', 'place-pill');
    button.dataset.restaurantId = id;
    button.dataset.focusKey = `place-${id}`;
    button.setAttribute('aria-pressed', String(id === model.activeId));
    button.setAttribute('aria-label', `${restaurant.name} · ${status.text}`);
    button.title = status.title || restaurant.name;
    button.append(el('span', status.busy ? 'spinner' : 'color-dot'), el('span', 'pill-name', restaurant.shortName),
      el('span', `pill-status${status.error ? ' error' : ''}`, status.text));
    button.addEventListener('click', () => controller.select(id));
    token.append(button);
    if (status.error) {
      const retry = el('button', 'retry-pill', 'Retry');
      retry.dataset.focusKey = `retry-${id}`;
      retry.setAttribute('aria-label', `Retry ${restaurant.shortName}`);
      retry.addEventListener('click', () => controller.retry(id));
      token.append(retry);
    }
    const remove = el('button', 'place-remove', '×');
    remove.setAttribute('aria-label', `Remove ${restaurant.shortName} from your palette`);
    remove.disabled = model.selectedIds.length === 1;
    remove.addEventListener('click', () => controller.remove(id));
    token.append(remove);
    return token;
  });
  $('palette').replaceChildren(...tokens);
  if (window.matchMedia('(max-width: 720px)').matches) {
    const palette = $('palette');
    const selected = palette.querySelector('.place-token.active');
    if (selected) {
      const left = selected.offsetLeft - palette.offsetLeft;
      const right = left + selected.offsetWidth;
      if (left < palette.scrollLeft) palette.scrollLeft = left;
      else if (right > palette.scrollLeft + palette.clientWidth) palette.scrollLeft = right - palette.clientWidth;
    }
  }
  if (focused) document.querySelector(`[data-focus-key="${focused}"]`)?.focus({ preventScroll: true });
  const active = model.restaurants.get(model.activeId);
  document.documentElement.style.setProperty('--active-color', active.color);
  $('brush-name').textContent = active.shortName;
  $('brush-dot').style.setProperty('--restaurant-color', active.color);
}

function renderBalance() {
  ledgerView = ledger.update(model);
  const { projectedRials: projected, spendingRials, recoveryRials, reservedRials, extentRials, zeroFraction } = ledgerView;
  $('balance-value').textContent = money(model.balanceRials);
  $('projected-value').textContent = money(projected);
  $('projected-value').style.color = projected < 0 ? 'var(--danger)' : '';
  const pending = [spendingRials ? `${money(spendingRials)} spending` : '', recoveryRials ? `${money(recoveryRials)} recovery` : ''].filter(Boolean);
  $('pending-label').textContent = pending.length ? `${pending.join(' · ')} pending`
    : model.changes().length ? 'Change queued behind a saving meal' : 'No pending changes';
  $('projection-label').textContent = isLive && model.changes().length ? 'Estimated after saving' : 'After saving';
  $('reserved-total').textContent = `${money(reservedRials)} reserved`;
  const keep = new Set();
  for (const entry of ledgerView.segments) {
    const { choice, state, startRials, endRials, lane } = entry;
    keep.add(choice.id);
    const restaurant = model.restaurants.get(choice.restaurantId);
    let segment = segmentNodes.get(choice.id);
    if (!segment) {
      segment = el('div');
      segment.dataset.ledgerId = choice.id;
      segmentNodes.set(choice.id, segment);
      $('balance-segments').append(segment);
    }
    segment.className = `balance-segment ${state} lane-${lane}`;
    segment.style.setProperty('--restaurant-color', restaurant.color);
    segment.style.left = `${startRials / extentRials * 100}%`;
    segment.style.width = `${(endRials - startRials) / extentRials * 100}%`;
    const status = state === 'adding' ? 'Pending food' : state === 'removing' ? 'Pending refund' : 'Reserved';
    segment.title = `${restaurant.shortName} · ${choice.name} · ${money(choice.priceRials)} toman · ${status}${isLive && state !== 'reserved' ? ' (estimate)' : ''}`;
  }
  for (const [id, node] of segmentNodes) if (!keep.has(id)) { node.remove(); segmentNodes.delete(id); }
  $('balance-zero').style.left = `${zeroFraction * 100}%`;
  $('balance-cash').style.left = `${zeroFraction * 100}%`;
  $('balance-track').classList.toggle('over-budget', projected < 0);
  $('balance-track').setAttribute('aria-label', `Known reservations minus ${money(reservedRials)} toman. Available balance ${money(model.balanceRials)}. Pending spending ${money(spendingRials)}, recovery ${money(recoveryRials)}. After saving ${money(projected)}.`);
  renderTicks();
  const busy = controller.saveJobs.has(model.activeId);
  const count = model.changes(model.activeId).length;
  $('submit').disabled = !count || busy || Boolean(model.issueFor(model.activeId)) || (isLive && !service.writable);
  $('submit').textContent = busy ? 'Saving…' : count ? `Submit · ${count}` : model.changes().length ? 'No changes here' : 'All saved';
  $('submit').setAttribute('aria-label', `Submit changes for ${model.restaurants.get(model.activeId).shortName}`);
  $('submit').title = (isLive && !service.writable ? service.writeReason || 'Reconnect dining before saving' : '') || model.issueFor(model.activeId) || 'Submit this restaurant’s changes';
  $('undo-changes').hidden = !count;
  $('undo-changes').disabled = busy;
}

function renderTicks() {
  if (!ledgerView) return;
  const width = $('balance-track').clientWidth;
  const keep = new Set();
  for (const tick of signedBalanceTicks(ledgerView, width)) {
    keep.add(tick.value);
    let label = tickNodes.get(tick.value);
    if (!label) {
      const absolute = Math.abs(tick.value);
      label = el('span', tick.value === 0 ? 'zero-tick' : '', `${tick.value < 0 ? '−' : ''}${absolute >= 1000 ? `${absolute / 1000}k` : absolute}`);
      label.dataset.tickValue = tick.value;
      tickNodes.set(tick.value, label);
      $('balance-ticks').append(label);
    }
    label.style.left = `${tick.fraction * 100}%`;
  }
  for (const [value, node] of tickNodes) if (!keep.has(value)) { node.remove(); tickNodes.delete(value); }
}

function createWeek(week, prepend = false) {
  if (weekNodes.has(week)) return weekNodes.get(week);
  const section = el('section', 'week');
  section.dataset.week = week;
  section.setAttribute('aria-label', `Week of ${englishDate.format(asDate(week))}`);
  const heading = el('div', 'week-heading');
  const left = el('div');
  const title = el('h2', '', faDate.formatRange(asDate(week), asDate(addDays(week, 6))));
  title.dir = 'auto';
  title.style.display = 'inline';
  left.append(title, el('span', 'week-relative', week === currentWeek ? 'This week' : week === nextWeek ? 'Next week' : ''));
  heading.append(left, el('span', 'week-gregorian', `${englishDate.format(asDate(week))} – ${englishDate.format(asDate(addDays(week, 6)))}`));
  const scroll = el('div', 'week-scroll');
  const grid = el('div', 'week-grid');
  grid.append(el('div'));
  for (let day = 0; day < 7; day++) {
    const date = addDays(week, day);
    const header = el('div', `day-heading${date === today ? ' is-today' : ''}`);
    header.append(el('strong', '', weekday.format(asDate(date))), el('span', '', shortFaDate.format(asDate(date))));
    grid.append(header);
  }
  const slots = [];
  for (const meal of MEALS) {
    grid.append(el('div', 'meal-heading', meal.name));
    for (let day = 0; day < 7; day++) {
      const date = addDays(week, day);
      const cell = el('article', `meal-slot${date === today && meal.id === currentMeal ? ' current-slot' : ''}`);
      cell.dataset.slot = `${date}|${meal.id}`;
      cell.setAttribute('aria-label', `${fullWeekday.format(asDate(date))}, ${englishDate.format(asDate(date))}, ${meal.name}`);
      grid.append(cell);
      slots.push({ cell, date, mealId: meal.id, week });
    }
  }
  scroll.append(grid);
  section.append(heading, scroll);
  if (prepend) $('weeks').prepend(section); else $('weeks').append(section);
  const entry = { section, slots };
  weekNodes.set(week, entry);
  weekObserver?.observe(section);
  return entry;
}

function card(choice, removing = false) {
  const restaurant = model.restaurants.get(choice.restaurantId);
  const draft = model.drafts.get(choice.id);
  const saving = model.inflight.has(choice.id);
  const failed = draft && model.saves.get(choice.restaurantId)?.state === 'error';
  const node = el('div', `food-card${draft ? ' is-draft' : ''}${removing ? ' is-removing' : ''}`);
  node.style.setProperty('--restaurant-color', restaurant.color);
  node.dataset.choiceId = choice.id;
  const top = el('div', 'food-card-top');
  const name = el('span', 'food-card-place', restaurant.shortName);
  name.dir = 'auto';
  top.append(name);
  if (!choice.locked && !removing) {
    const remove = el('button', 'card-remove', '×');
    remove.setAttribute('aria-label', `Remove ${choice.name}`);
    remove.addEventListener('click', () => {
      if (!model.selectedIds.includes(choice.restaurantId)) controller.add(choice.restaurantId);
      else controller.select(choice.restaurantId);
      controller.removeChoice(choice);
    });
    top.append(remove);
  }
  const food = el('span', 'food-name', choice.name);
  food.dir = 'rtl';
  food.title = choice.name;
  const bottom = el('div', 'food-card-bottom');
  const state = failed ? 'Not saved' : saving ? 'Saving…' : removing ? 'Cancel pending' : draft ? 'Draft' : choice.locked ? 'Reserved · Locked' : 'Reserved';
  bottom.append(el('span', '', `${money(choice.priceRials)} t`), el('span', draft ? 'draft-state' : '', state));
  node.append(top, food, bottom);
  return node;
}

function ghostOption(choice, selected) {
  const row = el('div', `ghost-option${selected ? ' is-selected' : ''}`);
  const button = el('button', 'ghost-choice');
  button.dataset.ghostId = choice.id;
  button.dataset.focusKey = `ghost-${choice.id}`;
  button.setAttribute('aria-pressed', String(selected));
  button.setAttribute('aria-label', `${choice.name} · ${money(choice.priceRials)} toman · ${selected ? 'Selected' : 'Choose'}`);
  const name = el('span', 'ghost-name', choice.name);
  name.dir = 'rtl';
  button.append(name, el('span', 'ghost-meta', `${money(choice.priceRials)} t${selected ? ' · Selected' : ''}`));
  button.addEventListener('click', () => controller.choose(choice));
  row.append(button);
  if (selected) {
    const remove = el('button', 'ghost-remove', '×');
    remove.dataset.focusKey = `ghost-remove-${choice.id}`;
    remove.setAttribute('aria-label', `Remove ${choice.name}`);
    remove.addEventListener('click', () => controller.removeChoice(choice));
    row.append(remove);
  }
  return row;
}

function renderSlots() {
  const focused = document.activeElement?.dataset.focusKey;
  const bookings = model.bookings();
  const cancellations = model.changes().filter(draft => !draft.desired && model.confirmed.has(draft.choice.id)).map(draft => draft.choice);
  const conflictSlots = new Set(model.conflicts().flatMap(choices => choices.map(slotKey)));
  for (const { slots } of weekNodes.values()) for (const { cell, date, mealId, week } of slots) {
    const key = `${date}|${mealId}`;
    const items = bookings.filter(choice => slotKey(choice) === key);
    const cancelling = cancellations.filter(choice => slotKey(choice) === key);
    const menu = model.menus.get(menuKey(model.activeId, week));
    const load = model.loads.get(menuKey(model.activeId, week));
    const foods = menu?.choices.filter(choice => choice.date === date && choice.mealId === mealId) || [];
    const unlocked = foods.filter(choice => !choice.locked);
    const others = el('div', 'slot-cards');
    others.append(...items.filter(choice => choice.restaurantId !== model.activeId).map(choice => card(choice)),
      ...cancelling.filter(choice => choice.restaurantId !== model.activeId).map(choice => card(choice, true)));
    const surface = el('div', `paint-surface${unlocked.length ? ' can-paint' : ''}`);
    const active = el('div', 'active-bookings slot-cards');
    active.append(...items.filter(choice => choice.restaurantId === model.activeId).map(choice => card(choice)),
      ...cancelling.filter(choice => choice.restaurantId === model.activeId).map(choice => card(choice, true)));
    surface.append(active);
    if (unlocked.length) {
      const ghosts = el('div', 'ghost-options');
      ghosts.setAttribute('role', 'group');
      ghosts.setAttribute('aria-label', `${date} ${mealName(mealId)} · ${model.restaurants.get(model.activeId).shortName}`);
      ghosts.append(...unlocked.map(choice => ghostOption(choice, items.some(item => item.id === choice.id))));
      surface.append(ghosts);
    } else {
      const state = el(load?.state === 'error' ? 'button' : 'span', 'slot-state');
      if (load?.state === 'error') {
        state.textContent = 'Retry menu';
        state.addEventListener('click', () => controller.load(model.activeId, week, true));
      } else if (!menu) {
        state.append(el('span', 'spinner'), el('span', '', 'Loading menu'));
      } else state.textContent = foods.length ? 'Reservation closed' : menu.published ? 'No food offered'
        : week < currentWeek ? 'Menu unavailable' : 'Not published yet';
      surface.append(state);
    }
    cell.classList.toggle('has-conflict', conflictSlots.has(key));
    cell.replaceChildren(others, surface);
    if (conflictSlots.has(key)) cell.append(el('p', 'slot-conflict', 'Meal entitlement conflict'));
  }
  if (focused?.startsWith('ghost-')) {
    const target = [...document.querySelectorAll('[data-focus-key]')].find(node => node.dataset.focusKey === focused);
    target?.focus({ preventScroll: true });
  }
}

function renderToday() {
  $('today-label').textContent = `Today · ${weekday.format(asDate(today))}`;
  const bookings = model.bookings().filter(choice => choice.date === today && model.confirmed.has(choice.id));
  const nodes = bookings.map(choice => {
    const restaurant = model.restaurants.get(choice.restaurantId);
    const node = el('span', 'today-booking');
    node.style.setProperty('--restaurant-color', restaurant.color);
    node.append(el('span', 'color-dot'), el('span', '', `${mealName(choice.mealId)} · ${restaurant.shortName} · ${choice.name}`));
    return node;
  });
  if (!nodes.length) nodes.push(el('span', '', [...model.loads.values()].some(load => load.week === currentWeek && load.state !== 'ready')
    ? 'Checking today’s reservations…' : 'No reservations found in your checked places.'));
  const checked = model.selectedIds.filter(id => model.loads.get(menuKey(id, currentWeek))?.state === 'ready').length;
  if (checked < model.selectedIds.length) nodes.push(el('span', 'muted', `${checked}/${model.selectedIds.length} places checked`));
  $('today-reservations').replaceChildren(...nodes);
}

function renderCoverage() {
  const week = [...controller.visibleWeeks].sort().find(item => item >= currentWeek) || currentWeek;
  const ready = model.selectedIds.filter(id => model.loads.get(menuKey(id, week))?.state === 'ready').length;
  $('coverage').textContent = `${ready} of ${model.selectedIds.length} places checked · Chosen places only`;
}

function render() {
  if (!model) return;
  if (isLive) {
    const expired = [...model.loads.values(), ...model.saves.values()].find(state => ['login-required', 'reconnect-required', 'account-changed'].includes(state.code));
    if (expired) {
      service.writable = false;
      $('live-connection').hidden = false;
      $('connection-message').textContent = `${expired.message} Your pending choices stay in this tab.`;
    }
  }
  renderPalette();
  renderBalance();
  renderSlots();
  renderToday();
  renderCoverage();
  const issue = model.issueFor(model.activeId);
  $('planner-warning').hidden = !issue;
  $('planner-warning').textContent = issue || '';
  $('fail-save').checked = service.failNextSave;
  $('fail-read').checked = service.failNextRead;
  if (controller.message && controller.message !== lastMessage) {
    lastMessage = controller.message;
    $('toast').textContent = lastMessage;
    $('toast').hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { $('toast').hidden = true; }, 6000);
  }
  persist();
}

function renderPlacePicker() {
  const search = $('place-search').value.trim().toLocaleLowerCase();
  const groups = [...new Set(restaurants.map(restaurant => restaurant.group))];
  const nodes = [];
  for (const group of groups) {
    const matches = restaurants.filter(restaurant => restaurant.group === group
      && `${restaurant.group} ${restaurant.name} ${restaurant.shortName}`.toLocaleLowerCase().includes(search));
    if (!matches.length) continue;
    const details = el('details', 'place-group');
    details.open = true;
    details.append(el('summary', '', group));
    const list = el('ul');
    for (const restaurant of matches) {
      const item = el('li');
      const label = el('label', 'place-option');
      label.style.setProperty('--restaurant-color', restaurant.color);
      const checkbox = el('input');
      checkbox.type = 'checkbox';
      checkbox.checked = model.selectedIds.includes(restaurant.id);
      checkbox.dataset.placeId = restaurant.id;
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) controller.add(restaurant.id); else controller.remove(restaurant.id);
        renderPlacePicker();
        $('place-groups').querySelector(`[data-place-id="${restaurant.id}"]`)?.focus();
      });
      const name = el('span', 'place-option-name', restaurant.name);
      name.dir = 'auto';
      label.append(checkbox, name, el('span', 'color-dot'));
      item.append(label);
      list.append(item);
    }
    details.append(list);
    nodes.push(details);
  }
  if (!nodes.length) nodes.push(el('p', 'food-empty', 'No matching restaurants.'));
  $('place-groups').replaceChildren(...nodes);
  $('selected-place-count').textContent = `${model.selectedIds.length} restaurants in your palette`;
}

function jumpTo(week) {
  allowPastLoad = false;
  createWeek(week);
  renderSlots();
  weekNodes.get(week).section.scrollIntoView({ behavior: 'auto', block: 'start' });
  $('jump-current').classList.toggle('is-current', week === currentWeek);
  $('jump-next').classList.toggle('is-current', week === nextWeek);
}

function showDialog(dialog) {
  allowPastLoad = false;
  modalScrollY = window.scrollY;
  dialog.showModal();
  requestAnimationFrame(() => window.scrollTo(0, modalScrollY));
}

for (const dialog of [$('place-picker'), $('simulation'), $('connection-report')]) dialog.addEventListener('close', () => {
  allowPastLoad = false;
  window.scrollTo(0, modalScrollY);
});

$('submit').addEventListener('click', () => controller.submit());
$('undo-changes').addEventListener('click', () => { model.discard(model.activeId); controller.changed(); });
$('add-place').addEventListener('click', () => { renderPlacePicker(); showDialog($('place-picker')); $('place-search').focus({ preventScroll: true }); });
$('close-places').addEventListener('click', () => $('place-picker').close());
$('done-places').addEventListener('click', () => $('place-picker').close());
$('place-search').addEventListener('input', renderPlacePicker);
$('jump-current').addEventListener('click', () => { jumpTo(currentWeek); });
$('jump-next').addEventListener('click', () => { jumpTo(nextWeek); });
$('open-simulation').addEventListener('click', () => { showDialog($('simulation')); });
$('close-simulation').addEventListener('click', () => $('simulation').close());
$('request-speed').addEventListener('change', event => { service.delayMs = Number(event.target.value); });
$('fail-save').addEventListener('change', event => { service.failNextSave = event.target.checked; });
$('fail-read').addEventListener('change', event => { service.failNextRead = event.target.checked; });
$('reset-demo').addEventListener('click', () => { localStorage.removeItem(storageKey); window.location.reload(); });
window.addEventListener('scroll', () => {
  if (window.scrollY !== lastScroll) scrollDirection = window.scrollY < lastScroll ? 'up' : 'down';
  lastScroll = window.scrollY;
}, { passive: true });
window.addEventListener('wheel', event => { allowPastLoad = event.deltaY < 0; }, { passive: true });
window.addEventListener('touchstart', event => { touchY = event.touches[0]?.clientY || 0; }, { passive: true });
window.addEventListener('touchmove', event => { allowPastLoad = (event.touches[0]?.clientY || 0) > touchY; }, { passive: true });
window.addEventListener('keydown', event => { if (['ArrowUp', 'PageUp', 'Home'].includes(event.key)) allowPastLoad = true; }, { passive: true });
window.addEventListener('pointerdown', event => { allowPastLoad = event.target === document.documentElement; }, { passive: true });

function initializeCalendar(preferences = {}) {
  const selectedIds = (preferences.selectedIds || []).filter(id => restaurants.some(restaurant => restaurant.id === id));
  if (!selectedIds.length) selectedIds.push(isLive ? restaurants[0].id : 'kooy', ...(!isLive ? ['engineering', 'garden'] : []));
  model = new PlannerModel({ restaurants, balanceRials: service.balanceRials, selectedIds,
    activeId: preferences.activeId, drafts: isLive ? [] : preferences.drafts, menus: isLive ? [] : preferences.menus });
  controller = new PlannerController({ model, service, onChange: render });
  createWeek(currentWeek);
  createWeek(nextWeek);
  render();
  new ResizeObserver(() => {
    document.documentElement.style.setProperty('--header-height', `${$('app-shell').offsetHeight}px`);
    renderTicks();
  }).observe($('app-shell'));
  weekObserver = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (entry.isIntersecting) controller.ensureWeek(entry.target.dataset.week);
      else controller.hideWeek(entry.target.dataset.week);
    }
  }, { rootMargin: '-220px 0px 120px 0px' });
  for (const { section } of weekNodes.values()) weekObserver.observe(section);
  const sentinelObserver = new IntersectionObserver(entries => {
    if (initialJump || addingWeek || $('place-picker').open || $('simulation').open || $('connection-report').open) return;
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const weeks = [...weekNodes.keys()].sort();
      if (entry.target.id === 'future-sentinel') {
        addingWeek = true;
        createWeek(addDays(weeks.at(-1), 7));
        renderSlots();
        requestAnimationFrame(() => { addingWeek = false; });
      } else if (allowPastLoad && scrollDirection === 'up') {
        addingWeek = true;
        const anchor = weekNodes.get(weeks[0]).section;
        const before = anchor.getBoundingClientRect().top;
        createWeek(addDays(weeks[0], -7), true);
        renderSlots();
        window.scrollBy(0, anchor.getBoundingClientRect().top - before);
        requestAnimationFrame(() => { addingWeek = false; });
      }
    }
  }, { rootMargin: '-240px 0px 160px 0px' });
  sentinelObserver.observe($('past-sentinel'));
  sentinelObserver.observe($('future-sentinel'));
  controller.ensureWeek(currentWeek, true);
  requestAnimationFrame(() => requestAnimationFrame(() => { jumpTo(nextWeek); initialJump = false; }));
}

async function connectDining() {
  if (connecting) return;
  connecting = true;
  $('live-connection').hidden = false;
  $('connection-message').textContent = 'Connecting and discovering your eligible restaurants…';
  $('connect-dining').disabled = true;
  $('live-reconnect').disabled = true;
  try {
    if (!await sessionClient.hasPermission() && !await sessionClient.requestPermission()) throw new Error('Allow dining access to connect your browser session.');
    const connection = await service.connect();
    if (model && accountTag !== connection.accountTag) {
      service.writable = false;
      throw new Error('The signed-in account changed. Open a new Loghmeh tab to start with that account. Your old drafts stay here.');
    }
    if (model && model.selectedIds.some(id => !connection.restaurants.some(restaurant => restaurant.id === id))) {
      service.writable = false;
      throw new Error('Your eligible restaurants changed. Open a new Loghmeh tab to choose from the updated list. Drafts stay here.');
    }
    accountTag = connection.accountTag;
    restaurants = connection.restaurants;
    if (!model) {
      let preferences;
      try { preferences = JSON.parse(localStorage.getItem('loghmeh:live:palette:v1')); } catch { /* Start with one place. */ }
      document.body.classList.remove('is-connecting');
      initializeCalendar(preferences || {});
    } else {
      model.balanceRials = connection.balanceRials;
      model.restaurants = new Map(restaurants.map(restaurant => [restaurant.id, restaurant]));
      model.loads.clear();
      for (const [id, state] of model.saves) if (['login-required', 'reconnect-required', 'account-changed'].includes(state.code)) model.saves.delete(id);
      for (const week of new Set([...controller.visibleWeeks, ...controller.backgroundWeeks])) controller.ensureWeek(week);
      render();
    }
    $('live-reconnect').textContent = 'Live · Refresh';
    $('live-connection').hidden = connection.writable;
    $('connection-message').textContent = connection.writeReason;
  } catch (error) {
    $('connection-message').textContent = error.message;
    $('connect-dining').textContent = 'Reconnect dining';
    $('live-reconnect').textContent = 'Reconnect dining';
  } finally {
    connecting = false;
    $('connect-dining').disabled = false;
    $('live-reconnect').disabled = false;
  }
}

$('connect-dining').addEventListener('click', connectDining);
$('live-reconnect').addEventListener('click', connectDining);
$('open-dining-login').addEventListener('click', () => sessionClient?.openLogin());
$('live-report-button').addEventListener('click', () => {
  $('live-report-json').value = JSON.stringify(service.connectionReport(), null, 2);
  showDialog($('connection-report'));
});
$('close-report').addEventListener('click', () => $('connection-report').close());
window.addEventListener('beforeunload', event => {
  if (isLive && model?.changes().length) { event.preventDefault(); event.returnValue = ''; }
});
if (isLive) {
  document.body.classList.add('is-connecting');
  $('open-simulation').hidden = true;
  $('live-reconnect').hidden = false;
  $('live-report-button').hidden = false;
  $('mode-link').hidden = false;
  $('data-notice').textContent = 'Live university data · One reservation tab at a time · Pending amounts are estimates.';
  connectDining();
} else {
  if (isExtension) { $('mode-link').hidden = false; $('mode-link').href = 'planner.html'; $('mode-link').textContent = 'Connect dining'; }
  initializeCalendar(saved?.model || {});
}
