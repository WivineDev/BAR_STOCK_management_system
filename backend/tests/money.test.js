import test from 'node:test';
import assert from 'node:assert/strict';
import { fromMilliQuantity, fromMinor, multiplyMinorByQuantity, quantityToMilli, sumMinor, toMinor, toQuantity } from '../src/utils/money.js';

test('parses RWF amounts into exact minor units', () => {
  assert.equal(toMinor('2000.25'), 200025n);
  assert.equal(fromMinor(toMinor('10000')), '10000.00');
  assert.equal(fromMinor(sumMinor([toMinor('8000'), toMinor('2000')])), '10000.00');
});

test('rejects invalid money and zero or over-precision quantities', () => {
  assert.throws(() => toMinor('1.001'));
  assert.throws(() => toMinor('-10'));
  assert.throws(() => toQuantity('0'));
  assert.throws(() => toQuantity('1.1234'));
});

test('calculates line totals using integer money arithmetic', () => {
  assert.equal(fromMinor(multiplyMinorByQuantity('2000.00', '5')), '10000.00');
  assert.equal(fromMinor(multiplyMinorByQuantity('0.33', '1.5')), '0.50');
});

test('supports the requested sales, debt, cash, and base-stock arithmetic examples', () => {
  const saleTotal = multiplyMinorByQuantity('2000.00', '5');
  assert.equal(fromMinor(saleTotal), '10000.00');
  assert.equal(fromMinor(saleTotal - toMinor('8000.00')), '2000.00');
  assert.equal(fromMinor(toMinor('20000.00') - toMinor('5000.00')), '15000.00');
  assert.equal(fromMinor(toMinor('50000.00') + toMinor('100000.00') - toMinor('20000.00')), '130000.00');
  assert.equal(Number('100') + 5 * 20 - 30, 170);
  assert.equal(fromMinor(toMinor('325000.00') - toMinor('330000.00')), '-5000.00');
});

test('keeps fractional stock adjustments exact to one thousandth of a unit', () => {
  assert.equal(fromMilliQuantity(quantityToMilli('0.1') + quantityToMilli('0.2')), '0.3');
  assert.equal(fromMilliQuantity(quantityToMilli('5.125') - quantityToMilli('0.125')), '5.0');
});
