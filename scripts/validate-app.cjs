'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

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

console.log('PASS: JavaScript syntax');
console.log('PASS: required UI elements');
console.log('PASS: 11 services and 8+8 parts suggestions');
console.log('PASS: 5 calculation scenarios');
console.log('PASS: add service/part and saved estimate code paths');
