import { parseBootstrap, parseRestaurants, parseMenu } from '../extension/lib/parser.mjs';
import { bootstrapFixture, restaurantsFixture, menuFixture } from '../extension/demo.mjs';

let failures = 0;
let checks = 0;
function check(name, action) {
  checks++;
  const item = document.createElement('li');
  try { action(); item.textContent = `PASS · ${name}`; item.className = 'pass'; }
  catch (error) { failures++; item.textContent = `FAIL · ${name}: ${error.message}`; item.className = 'fail'; }
  document.getElementById('results').append(item);
}
function assert(condition, message = 'Assertion failed') { if (!condition) throw new Error(message); }
function rejects(action, code) {
  let thrown;
  try { action(); } catch (error) { thrown = error; }
  assert(thrown?.code === code, `Expected ${code}`);
}
check('Recognizes authenticated reservation controls', () => assert(parseBootstrap(bootstrapFixture).groups.length === 1));
check('Recognizes login HTML as an expired session', () => rejects(() => parseBootstrap('<input name="Username">'), 'login-required'));
check('Rejects a generic error page instead of returning no groups', () => rejects(() => parseBootstrap('<h1>Error</h1>'), 'unexpected-response'));
check('Parses the restaurant JSON contract', () => assert(parseRestaurants(restaurantsFixture)[0].id === '20'));
check('Rejects unexpected restaurant data', () => rejects(() => parseRestaurants('[{"id":"../Index","value":"x"}]'), 'unexpected-response'));
check('Parses dining\'s wrapped labels and deduplicates mobile/desktop foods', () => {
  const menu = parseMenu(menuFixture);
  assert(menu.rawChoiceCount === 4 && menu.choices.length === 2);
  assert(menu.reservedCount === 1 && menu.disabledCount === 1);
  assert(menu.choices[0].priceRials === 250000);
  assert(menu.choices[0].name === 'چلو خورش نمونه');
});
check('Supports explicitly associated labels separated from the checkbox', () => {
  const associated = menuFixture.replaceAll('class="reserveFoodFoodDiv"', 'class="other-wrapper"')
    .replace(/(<input[^>]*id=")([^"]+)("[^>]*>\s*<div[^>]*>\s*<label[^>]*for=")[^"]+/gu,
      (_, start, id, middle) => start + id + middle + id);
  assert(parseMenu(associated).choices.length === 2);
});
check('Keeps support for labels directly beside a checkbox', () => {
  const doc = new DOMParser().parseFromString(menuFixture, 'text/html');
  for (const input of doc.querySelectorAll('input.reserveFoodCheckBox')) {
    const container = input.closest('.reserveFoodFoodDiv');
    const label = container.querySelector('label.reserveFoodCheckBox');
    container.className = 'plain-wrapper';
    input.after(label);
  }
  assert(parseMenu(doc.documentElement.outerHTML).choices.length === 2);
});
check('Does not borrow a label from the next food when one is missing', () => {
  const doc = new DOMParser().parseFromString(menuFixture, 'text/html');
  doc.querySelector('label.reserveFoodCheckBox').remove();
  rejects(() => parseMenu(doc.documentElement.outerHTML), 'unexpected-response');
});
check('Rejects ambiguous food labels instead of choosing a different food', () => {
  const doc = new DOMParser().parseFromString(menuFixture, 'text/html');
  const label = doc.querySelector('label.reserveFoodCheckBox');
  label.after(label.cloneNode(true));
  rejects(() => parseMenu(doc.documentElement.outerHTML), 'unexpected-response');
});
check('Rejects disagreeing duplicate reservation states', () => rejects(() => parseMenu(menuFixture.replace('data-prechecked="true"', 'data-prechecked="false"')), 'unexpected-response'));
check('Accepts a recognized week with no food options', () => assert(parseMenu(menuFixture.slice(0, menuFixture.indexOf('</div>') + 6)).choices.length === 0));
check('Rejects an incomplete week rather than labelling it a valid menu', () => rejects(() => parseMenu('<div id="TopDateDiv">1405/08/02</div>'), 'unexpected-response'));
check('Does not execute response scripts', () => {
  const before = document.title;
  parseMenu(menuFixture + '<script>document.title="UNSAFE"</' + 'script>');
  assert(document.title === before);
});
document.getElementById('summary').textContent = `${checks - failures}/${checks} checks passed${failures ? `; ${failures} failed` : ''}.`;
document.documentElement.dataset.testsPassed = failures ? 'false' : 'true';
