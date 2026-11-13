'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync('index.html', 'utf8');
const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
assert.equal(scripts.length, 1, 'Expected exactly one application script');
const js = scripts[0];
new vm.Script(js, { filename: 'index.html:inline-script' });

const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
const requiredIds = [
  'meta','lang','cur','rate','cat','works','parts','pl','disc','vat','markup',
  'vatOn','tW','tP','tD','tV','tT','barT','saved','addPart','save','newEst',
  'send','bPrint','bCopy','bTg','bMail','bWa','inst'
];
for (const id of requiredIds) assert(ids.has(id), 'Missing required HTML element: ' + id);

const catMatch = js.match(/const CAT=(\[[\s\S]*?\]);/);
const partsMatch = js.match(/const PARTS=(\{[\s\S]*?\});/);
assert(catMatch, 'Service catalog not found');
assert(partsMatch, 'Parts catalog not found');
const CAT = vm.runInNewContext(catMatch[1]);
const PARTS = vm.runInNewContext('(' + partsMatch[1] + ')');
assert.equal(CAT.length, 11, 'Expected the original 11 predefined services');
assert.equal(PARTS.ru.length, 8, 'Expected 8 Russian parts suggestions');
assert.equal(PARTS.en.length, 8, 'Expected 8 English parts suggestions');
assert(CAT.every(x => typeof x[0] === 'string' && Number.isFinite(x[1]) && typeof x[2] === 'string'),
  'Every service must have Russian/English names and labor hours');

const line = prefix => {
  const value = js.split('\n').find(x => x.startsWith(prefix));
  assert(value, 'Calculation helper missing: ' + prefix);
  return value;
};
const calc = js.match(/function calc\(\)\{[\s\S]*?\n\}/);
assert(calc, 'Calculation function missing');
const calculationSource = [
  line('const num='), line('const workCost='), line('const partRaw='),
  line('const partCost='), line('const rd='), calc[0],
  'return state => { S = state; return calc(); };'
].join('\n');
const runCalc = new Function('let S; ' + calculationSource)();

const cases = [
  {
    name: 'labor only',
    state: { rate:8000, markup:0, disc:0, vat:16, vatOn:false, cur:'KZT',
      works:[{h:1.5}], parts:[] },
    expected: { w:12000, p:0, t:12000 }
  },
  {
    name: 'parts with markup',
    state: { rate:8000, markup:10, disc:0, vat:16, vatOn:false, cur:'KZT',
      works:[], parts:[{q:2,p:1000}] },
    expected: { w:0, p:2200, t:2200 }
  },
  {
    name: 'labor + parts + discount + VAT',
    state: { rate:8000, markup:10, disc:10, vat:16, vatOn:true, cur:'KZT',
      works:[{h:1}], parts:[{q:2,p:1000}] },
    expected: { w:8000, p:2200, d:1020, v:1468.8, t:10649 }
  },
  {
    name: 'USD decimal rounding',
    state: { rate:12.35, markup:0, disc:0, vat:0, vatOn:false, cur:'USD',
      works:[{h:1.5}], parts:[{q:1,p:2.25}] },
    expected: { w:18.525, p:2.25, t:20.78 }
  },
  {
    name: 'zero values',
    state: { rate:0, markup:0, disc:0, vat:0, vatOn:false, cur:'KZT',
      works:[{h:0}], parts:[{q:0,p:0}] },
    expected: { w:0, p:0, t:0 }
  }
];
for (const test of cases) {
  const result = runCalc(test.state);
  for (const [key, expected] of Object.entries(test.expected)) {
    assert(Math.abs(result[key] - expected) < 0.001,
      test.name + ': expected ' + key + '=' + expected + ', got ' + result[key]);
  }
}
assert(js.includes("S.works.push(v==='x'?{name:'',h:1}"),
  'Adding a custom service must still work');
assert(js.includes("S.parts.push({name:'',q:1,p:0})"),
  'Adding a custom part must still work');
assert(js.includes("ST.set('estimates',JSON.stringify(a))"),
  'Saving estimates must remain enabled');
assert(js.includes("S=Object.assign(blank(),f)"),
  'Opening saved estimates must remain enabled');


const dom = new JSDOM(html, {
  url: 'https://example.test/',
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  beforeParse(window) {
    window.scrollTo = () => {};
    window.print = () => {};
  }
});
const w = dom.window;
const $ = id => w.document.getElementById(id);
const fire = (element, type) => element.dispatchEvent(new w.Event(type, { bubbles: true }));
assert.equal($('cat').options.length, 13, 'The service selector must show 11 services plus two controls');
assert.equal($('pl').options.length, 8, 'Russian parts suggestions must be visible at startup');

$('cat').value = '0';
fire($('cat'), 'change');
assert.equal($('works').querySelectorAll('[data-f="name"]').length, 1, 'Selecting a service must add a work row');
assert.equal($('works').querySelector('[data-f="h"]').value, '0.7', 'Service labor hours must be prefilled');

$('rate').value = '10000';
fire($('rate'), 'input');
$('addPart').click();
const partName = $('parts').querySelector('[data-f="name"]');
const partQty = $('parts').querySelector('[data-f="q"]');
const partPrice = $('parts').querySelector('[data-f="p"]');
partName.value = 'Масляный фильтр'; fire(partName, 'input');
partQty.value = '2'; fire(partQty, 'input');
partPrice.value = '1000'; fire(partPrice, 'input');
$('markup').value = '10'; fire($('markup'), 'input');
$('disc').value = '10'; fire($('disc'), 'input');
$('vat').value = '16'; fire($('vat'), 'input');
$('vatOn').checked = true; fire($('vatOn'), 'change');
assert($('tT').textContent.replace(/\s/g, '').includes('9605'), 'Mixed labor/parts/markup/discount/VAT total must be 9,605 KZT');

$('cat').value = 'x'; fire($('cat'), 'change');
const customWork = [...$('works').querySelectorAll('[data-f="name"]')].at(-1);
customWork.value = 'Диагностика электрики'; fire(customWork, 'input');
assert.equal($('works').querySelectorAll('[data-f="name"]').length, 2, 'Other service must add an editable work row');

$('save').click();
assert.equal($('saved').querySelectorAll('[data-open]').length, 1, 'Save must create a saved estimate');
$('newEst').click();
assert.equal($('works').querySelectorAll('[data-f="name"]').length, 0, 'New estimate must clear work rows');
$('saved').querySelector('[data-open]').click();
assert.equal($('works').querySelectorAll('[data-f="name"]').length, 2, 'Opening a saved estimate must restore work rows');
assert.equal($('parts').querySelectorAll('[data-f="name"]').length, 1, 'Opening a saved estimate must restore parts');

$('lang').value = 'en'; fire($('lang'), 'change');
assert.equal($('pl').options[0].value, 'Engine oil 5W-30, 4 L', 'Language switch must update parts suggestions');
assert([...$('cat').options].some(o => o.textContent === 'Computer diagnostics'), 'Language switch must translate service catalog');
assert.equal($('works').querySelectorAll('[data-f="name"]').length, 2, 'Language switch must preserve estimate rows');

dom.window.close();
console.log('PASS: real DOM smoke test (service/part entry, totals, save/open, RU/EN)');

console.log('PASS: JavaScript syntax');
console.log('PASS: required UI elements');
console.log('PASS: 11 services and 8+8 parts suggestions');
console.log('PASS: 5 calculation scenarios');
console.log('PASS: add service/part and saved estimate code paths');
