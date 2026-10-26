import { parseBootstrap, parseRestaurants, parseMenu } from './lib/parser.ts';
import { ProbeError } from './lib/transport.ts';
import type { ProbeClient } from './lib/client.ts';

// Entirely fictional fixtures. Preview mode never calls the university.
export const bootstrapFixture = '<select id="PersonGroup"><option value="10">گروه نمونه</option></select><select id="EWalletId"><option value="1">کیف پول نمونه</option></select><span id="headerCredit">2,000,000</span><div id="divPersonInfo">شماره دانشجویی: 9999999999</div>';
export const restaurantsFixture = '[{"id":20,"value":"رستوران نمونه"}]';
const prefix = (id: number, meal: number) => `rr${id}fp10dd2026_10_25ppp00-00dt2026_10_25ppp00-00me${meal}dm${meal}fo${100 + meal}ftf2000_01_01ppp00-00ftt2000_01_01ppp00-00gff2000_01_01ppp00-00gft2000_01_01ppp00-00rest20`;
// Match dining's wrapper and nested count label, including its mismatched `for`.
const food = (copy: string, id: number, meal: number, name: string, selected: boolean, disabled: boolean) => `<div class="reserveFoodFoodDiv">
  <input type="checkbox" class="reserveFoodCheckBox" id="${prefix(id, meal)}---${copy}"
    data-prechecked="${selected}" data-count="0" data-precount="${selected ? 1 : 0}" data-food-options="" data-diet-food="diet---fixture-${copy}-${id}" ${selected ? 'checked' : ''} ${disabled ? 'disabled' : ''}>
  <div style="float:right;margin-right:2px;">
    <label class="reserveFoodCheckBox" for="${prefix(id, meal)}">${name}
      <span class="reserveFoodType">250,000</span><label class="countLabel">(۲)</label>
    </label>
  </div>
</div>`;
export const menuFixture = `<span id="reserveCredit">2,000,000</span><div id="TopDateDiv">1405/08/02 1405/08/03 1405/08/04 1405/08/05 1405/08/06 1405/08/07 1405/08/08</div>
${['phone', 'desktop'].map(copy => food(copy, 0, 1, 'چلو خورش نمونه', false, false) + food(copy, 7, 3, 'خوراک نمونه', true, true)).join('')}`;

export function createDemoClient(scenario: string | null = ''): ProbeClient {
  const diagnostic = (operation: string) => ({ operation, path: '(fictional fixture)', method: 'LOCAL', status: 200, elapsedMs: 0 });
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
