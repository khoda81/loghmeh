import { ProbeError } from './transport.ts';

const clean = (text: string | null | undefined) => (text || '').replace(/\s+/gu, ' ').trim();
const digits = (text: string) => String(text).replace(/[۰-۹٠-٩]/gu, digit => String('۰۱۲۳۴۵۶۷۸۹'.includes(digit)
  ? '۰۱۲۳۴۵۶۷۸۹'.indexOf(digit) : '٠١٢٣٤٥٦٧٨٩'.indexOf(digit)));
const invalid = (message: string) => new ProbeError('unexpected-response', message);

function documentFrom(html: unknown) {
  if (typeof html !== 'string' || html.length > 5_000_000) throw invalid('The response is not a supported menu page.');
  // The returned document is never inserted into the live page. Scripts stay inert.
  const doc = new DOMParser().parseFromString(html, 'text/html');
  if (doc.querySelector('input[name="Username"], input[name="Password"]')) {
    throw new ProbeError('login-required', 'The server returned a login page. Sign in, then check again.');
  }
  return doc;
}

export function parseBootstrap(html: unknown) {
  const doc = documentFrom(html);
  const select = doc.querySelector<HTMLSelectElement>('select#PersonGroup');
  if (!select) throw invalid('Dining did not return a recognized reservation page.');
  const groups = Array.from(select.options)
    .filter(option => /^[1-9]\d*$/.test(option.value))
    .map(option => ({ id: option.value, name: clean(option.textContent) }));
  return { groups, selectedGroupId: select.value };
}

export function parseRestaurants(body: string) {
  let data;
  try { data = JSON.parse(body); } catch {
    documentFrom(body); // Recognize an expired-session login response.
    throw invalid('Dining did not return a restaurant list.');
  }
  if (!Array.isArray(data)) throw invalid('Dining returned an unfamiliar restaurant list.');
  const unique = new Map<string, { id: string; name: string }>();
  for (const row of data) {
    if (!row || !/^[1-9]\d*$/.test(String(row.id)) || typeof row.value !== 'string') {
      throw invalid('Dining returned an unfamiliar restaurant entry.');
    }
    unique.set(String(row.id), { id: String(row.id), name: clean(row.value) });
  }
  return [...unique.values()];
}

function foodLabel(input: HTMLInputElement) {
  let labels: Element[] = [...input.labels ?? []].filter(label => !label.classList.contains('countLabel'));
  const cell = input.closest('.reserveFoodFoodDiv');
  if (!labels.length && cell) {
    // Dining wraps the label in a div and its `for` omits the checkbox UUID.
    // Stay inside one food cell rather than accidentally using the next food.
    const inputs = [...cell.querySelectorAll('input.reserveFoodCheckBox[type="checkbox"]')]
      .filter(node => node.closest('.reserveFoodFoodDiv') === cell);
    if (inputs.length !== 1) throw invalid('A food entry has ambiguous checkbox labels.');
    labels = [...cell.querySelectorAll('label.reserveFoodCheckBox')]
      .filter(label => label.closest('.reserveFoodFoodDiv') === cell);
  }
  if (!labels.length && input.nextElementSibling?.matches('label:not(.countLabel)')) {
    labels = [input.nextElementSibling];
  }
  if (labels.length !== 1) throw invalid(labels.length
    ? 'A food entry has ambiguous labels.' : 'A food entry is missing its label.');
  return labels[0];
}

export interface ParsedChoice {
  serverKey: string;
  date: string;
  mealId: string;
  meal: string;
  name: string;
  priceRials: number | null;
  reserved: boolean;
  disabled: boolean;
}

export function parseMenu(html: unknown) {
  const doc = documentFrom(html);
  const header = doc.querySelector('#TopDateDiv');
  const dates = [...new Set(digits(header?.textContent || '').match(/\d{4}\/\d{1,2}\/\d{1,2}/gu) || [])];
  if (dates.length !== 7) throw invalid('Dining did not return a recognized seven-day menu.');
  const unique = new Map<string, ParsedChoice>();
  let rawChoiceCount = 0;
  for (const input of doc.querySelectorAll<HTMLInputElement>('input.reserveFoodCheckBox[type="checkbox"]')) {
    if (!input.id.startsWith('rr') || !input.id.includes('---')) continue;
    rawChoiceCount++;
    const key = input.id.split('---')[0];
    const date = key.match(/dd(\d{4})_(\d{2})_(\d{2})ppp/u);
    const mealId = key.match(/me(\d+)dm/u)?.[1];
    if (!date || !mealId) throw invalid('A food entry has an unfamiliar date or meal identifier.');
    const label = foodLabel(input);
    const name = label.cloneNode(true) as Element;
    name.querySelectorAll('.reserveFoodType, .countLabel').forEach(node => node.remove());
    if (!clean(name.textContent)) throw invalid('A food entry is missing its name.');
    const priceText = digits(label.querySelector('.reserveFoodType')?.textContent || '').replace(/[,،\s]/gu, '');
    const choice = {
      serverKey: key,
      date: `${date[1]}-${date[2]}-${date[3]}`,
      mealId,
      meal: ({ 1: 'ناهار', 3: 'شام' } as Record<string, string>)[mealId] || `Meal ${mealId}`,
      name: clean(name.textContent),
      priceRials: /^\d+(?:\.\d+)?$/u.test(priceText) ? Number(priceText) : null,
      reserved: input.hasAttribute('data-prechecked')
        ? input.getAttribute('data-prechecked')!.toLowerCase() === 'true' : input.hasAttribute('checked'),
      disabled: input.hasAttribute('disabled'),
    };
    if (unique.has(key) && JSON.stringify(unique.get(key)) !== JSON.stringify(choice)) {
      throw invalid('The mobile and desktop copies disagree. Please reload dining before checking again.');
    }
    unique.set(key, choice);
  }
  const choices = [...unique.values()].sort((a, b) => a.date.localeCompare(b.date) || Number(a.mealId) - Number(b.mealId));
  return {
    dates, choices, rawChoiceCount,
    reservedCount: choices.filter(choice => choice.reserved).length,
    disabledCount: choices.filter(choice => choice.disabled).length,
  };
}
