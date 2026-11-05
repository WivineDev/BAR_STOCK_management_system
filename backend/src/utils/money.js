const AMOUNT = /^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/;

export function toMinor(value, field = 'amount') {
  const text = String(value ?? '').trim();
  if (!AMOUNT.test(text)) throw Object.assign(new Error(`${field} must be a non-negative amount with up to two decimal places`), { status: 400 });
  const [whole, fraction = ''] = text.split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
}

export function fromMinor(value) {
  const amount = BigInt(value);
  const sign = amount < 0n ? '-' : '';
  const absolute = amount < 0n ? -amount : amount;
  const whole = absolute / 100n;
  const fraction = String(absolute % 100n).padStart(2, '0');
  return `${sign}${whole}.${fraction}`;
}

export function sumMinor(values) { return values.reduce((sum, value) => sum + BigInt(value), 0n); }

export function quantityToMilli(value) {
  const text = String(value ?? '').trim();
  const negative = text.startsWith('-');
  const unsigned = negative ? text.slice(1) : text;
  if (!/^(?:0|[1-9]\d{0,8})(?:\.\d{1,3})?$/.test(unsigned)) throw Object.assign(new Error('Quantity must be a number with up to three decimal places'), { status: 400 });
  const [whole, fraction = ''] = unsigned.split('.');
  const result = BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, '0'));
  return negative ? -result : result;
}

export function fromMilliQuantity(value) {
  const quantity = BigInt(value);
  const sign = quantity < 0n ? '-' : '';
  const absolute = quantity < 0n ? -quantity : quantity;
  const whole = absolute / 1000n;
  const fraction = String(absolute % 1000n).padStart(3, '0').replace(/0+$/, '');
  return `${sign}${whole}.${fraction || '0'}`;
}

export function toQuantity(value, field = 'quantity', allowNegative = false) {
  const text = String(value ?? '').trim();
  const pattern = allowNegative ? /^-?(?:0|[1-9]\d{0,8})(?:\.\d{1,3})?$/ : /^(?:0|[1-9]\d{0,8})(?:\.\d{1,3})?$/;
  if (!pattern.test(text) || Number(text) === 0) throw Object.assign(new Error(`${field} must be a non-zero quantity with up to three decimal places`), { status: 400 });
  return text;
}

export function multiplyMinorByQuantity(price, quantity) {
  const minor = toMinor(price, 'price');
  const qty = toQuantity(quantity);
  const [whole, fraction = ''] = qty.split('.');
  const thousandths = BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, '0'));
  const product = minor * thousandths;
  return (product + 500n) / 1000n;
}
