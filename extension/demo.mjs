import { parseBootstrap, parseRestaurants, parseMenu } from './lib/parser.mjs';
import { ProbeError } from './lib/transport.mjs';

// Entirely fictional fixtures. Preview mode never calls the university.
export const bootstrapFixture = '<select id="PersonGroup"><option value="10">گروه نمونه</option></select>';
export const restaurantsFixture = '[{"id":20,"value":"رستوران نمونه"}]';
const prefix = (id, meal) => `rr${id}fp10dd2026_10_25ppp00-00dt2026_10_25ppp00-00me${meal}dm${meal}fo${100 + meal}rest20`;
// Match dining's wrapper and nested count label, including its mismatched `for`.
const food = (copy, id, meal, name, selected, disabled) => `<div class="reserveFoodFoodDiv">
  <input type="checkbox" class="reserveFoodCheckBox" id="${prefix(id, meal)}---${copy}"
    data-prechecked="${selected}" ${selected ? 'checked' : ''} ${disabled ? 'disabled' : ''}>
  <div style="float:right;margin-right:2px;">
    <label class="reserveFoodCheckBox" for="${prefix(id, meal)}">${name}
      <span class="reserveFoodType">250,000</span><label class="countLabel">(۲)</label>
    </label>
  </div>
</div>`;
export const menuFixture = `<div id="TopDateDiv">1405/08/02 1405/08/03 1405/08/04 1405/08/05 1405/08/06 1405/08/07 1405/08/08</div>
${['phone', 'desktop'].map(copy => food(copy, 0, 1, 'چلو خورش نمونه', false, false) + food(copy, 7, 3, 'خوراک نمونه', true, true)).join('')}`;

export function createDemoClient(scenario = '') {
  const diagnostic = operation => ({ operation, path: '(fictional fixture)', method: 'LOCAL', status: 200, elapsedMs: 0 });
  return {
    mode: 'preview',
    hasPermission: async () => true,
    requestPermission: async () => true,
    openLogin: async () => {},
    async bootstrap() {
      if (scenario === 'expired') parseBootstrap('<input name="Username"><input name="Password" type="password">');
      if (scenario === 'network') throw new ProbeError('network-error', 'Preview: simulated network failure.');
      return { ...parseBootstrap(bootstrapFixture), diagnostic: diagnostic('bootstrap') };
    },
    async restaurants() {
      return { restaurants: parseRestaurants(restaurantsFixture), diagnostic: diagnostic('restaurants') };
    },
    async menu() {
      return { ...parseMenu(menuFixture), diagnostic: diagnostic('menu') };
    },
  };
}
