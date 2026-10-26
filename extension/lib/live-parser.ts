import { parseBootstrap, parseMenu } from './parser.ts';
import { ProbeError } from './transport.ts';
import { addDays, weekOf } from './planner-model.ts';
import type { Choice, Menu, Restaurant } from './types.ts';

const digits = (value: unknown) => String(value ?? '').replace(/[۰-۹٠-٩]/gu, digit => String('۰۱۲۳۴۵۶۷۸۹'.includes(digit)
  ? '۰۱۲۳۴۵۶۷۸۹'.indexOf(digit) : '٠١٢٣٤٥٦٧٨٩'.indexOf(digit)));
const number = (value: unknown) => {
  const clean = digits(value).replace(/[,،\s]/gu, '');
  return /^\d+$/u.test(clean) && Number.isSafeInteger(Number(clean)) ? Number(clean) : null;
};
const invalid = (message: string) => new ProbeError('unexpected-response', message);
const persian = new Intl.DateTimeFormat('en-u-ca-persian', { year: 'numeric', month: 'numeric', day: 'numeric', timeZone: 'UTC' });
const dateCache = new Map<string, string>();

// Use the browser's Persian calendar, including leap years, without executing server scripts.
export function persianToISO(text: string) {
  if (dateCache.has(text)) return dateCache.get(text)!;
  const parts = digits(text).split('/').map(Number);
  if (parts.length !== 3 || parts.some(value => !Number.isInteger(value))) throw invalid('Unrecognized calendar date.');
  const [year, month, day] = parts;
  const target = year * 10000 + month * 100 + day;
  let low = Math.floor(Date.UTC(year + 621, 0, 1) / 86400000);
  let high = Math.floor(Date.UTC(year + 622, 11, 31) / 86400000);
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const date = new Date(middle * 86400000);
    const formatted = Object.fromEntries(persian.formatToParts(date).filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]));
    const value = formatted.year * 10000 + formatted.month * 100 + formatted.day;
    if (value === target) {
      const iso = date.toISOString().slice(0, 10);
      dateCache.set(text, iso);
      return iso;
    }
    if (value < target) low = middle + 1; else high = middle - 1;
  }
  throw invalid('Dining returned an invalid Persian calendar date.');
}

export type LiveBootstrap = ReturnType<typeof parseLiveBootstrap>;

export function parseLiveBootstrap(html: string) {
  const bootstrap = parseBootstrap(html);
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const wallet = doc.querySelector<HTMLSelectElement>('#EWalletId');
  const wallets = [...(wallet?.options || [])].filter(option => /^[1-9]\d*$/u.test(option.value))
    .map(option => ({ id: option.value, name: option.textContent?.trim() ?? '' }));
  const credit = doc.querySelector('#headerCredit')?.textContent?.match(/[۰-۹٠-٩\d][۰-۹٠-٩\d,،]*/u)?.[0];
  const identity = digits(doc.querySelector('#divPersonInfo')?.textContent || '').match(/شماره\s*دانشجویی\s*[:：]?\s*(\d{5,})/u)?.[1];
  return { ...bootstrap, wallets, walletId: wallet?.value, balanceRials: number(credit), identity };
}

export function parseLiveMenu(html: string, restaurant: Pick<Restaurant, 'id' | 'restId'>): Menu {
  const parsed = parseMenu(html);
  const dates = parsed.dates.map(persianToISO);
  const week = dates[0];
  if (weekOf(week) !== week || dates.some((date, index) => date !== addDays(week, index))) {
    throw invalid('Dining returned nonconsecutive week dates.');
  }
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const inputs = [...doc.querySelectorAll('input.reserveFoodCheckBox[type="checkbox"]')];
  const choices = parsed.choices.map((choice): Choice => {
    const copies = inputs.filter(node => node.id.split('---')[0] === choice.serverKey);
    const input = copies[0];
    const metadata = (node: Element) => JSON.stringify([node.getAttribute('data-count'), node.getAttribute('data-precount'),
      Boolean(node.getAttribute('data-food-options'))]);
    if (copies.some(copy => metadata(copy) !== metadata(input))) throw invalid('Dining copies disagree about food quantities or extras.');
    const key = choice.serverKey;
    const program = key.match(/fp(\d+)dd/u)?.[1];
    const foodId = key.match(/fo(\d+)(?:ftf|rest)/u)?.[1];
    const restId = key.match(/rest(\d+)$/u)?.[1];
    if (!input || !program || !foodId || restId !== restaurant.restId || !dates.includes(choice.date)
        || choice.priceRials === null || !Number.isSafeInteger(choice.priceRials) || choice.priceRials < 0) {
      throw invalid('A food does not match the requested restaurant, date, or price.');
    }
    const count = number(input.getAttribute('data-count'));
    const previousCount = number(input.getAttribute('data-precount'));
    const extraIds = (input.getAttribute('data-food-options') || '').split(',').filter(Boolean);
    const diet = input.getAttribute('data-diet-food');
    const dietSelect = diet ? doc.getElementById(`dietTypeSelect--${diet.split('---')[1]}`) : null;
    const unsupported = extraIds.length ? 'This food has optional extras. Edit it on dining for now.'
      : dietSelect ? 'This food has a diet option. Edit it on dining for now.'
        : count === null || previousCount === null ? 'Dining did not supply quantity fields. Reload before editing.'
          : count > 1 || previousCount > 1 ? 'This reservation has multiple portions. Edit it on dining for now.' : '';
    return { id: `${restaurant.id}:${choice.date}:${choice.mealId}:${program}:${foodId}`,
      restaurantId: restaurant.id, week, date: choice.date, mealId: choice.mealId, name: choice.name,
      priceRials: choice.priceRials * (choice.reserved ? Math.max(1, previousCount || 0) : 1),
      unitPriceRials: choice.priceRials, reserved: choice.reserved, serverKey: key, count, previousCount,
      locked: choice.disabled || Boolean(unsupported),
      lockReason: unsupported || (choice.disabled ? 'Dining has closed changes for this food.' : '') };
  });
  const balanceText = doc.querySelector('#reserveCredit')?.textContent;
  const balanceRials = number(balanceText);
  return { restaurantId: restaurant.id, week, choices, dates, reservedIds: choices.filter(choice => choice.reserved).map(choice => choice.id),
    published: choices.length ? true : null, balanceRials, rawChoiceCount: parsed.rawChoiceCount };
}
