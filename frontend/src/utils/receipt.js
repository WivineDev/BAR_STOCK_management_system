const plain = (value) => new Intl.NumberFormat('en-RW', { maximumFractionDigits: 0 }).format(Number(value || 0));
const asciiMoney = (value) => `RWF ${plain(value)}`;

const center = (text, width = 42) => {
  const pad = Math.max(0, Math.floor((width - text.length) / 2));
  return ' '.repeat(pad) + text;
};

const row = (left, right, width = 42) => {
  const value = String(right);
  const space = Math.max(1, width - String(left).length - value.length);
  return `${left}${' '.repeat(space)}${value}`;
};

export function buildReceiptText(sale, businessName = 'Umucyobar') {
  const created = sale.createdAt ? new Date(sale.createdAt) : new Date();
  const lines = [
    center(businessName.toUpperCase()),
    center('SALES RECEIPT'),
    '',
    row(`Receipt: ${sale.reference}`, ''),
    row(`Date: ${created.toLocaleString()}`, ''),
    row(`Cashier: ${sale.cashierName || '-'}`, ''),
    row(`Customer: ${sale.customerName || 'Walk-in customer'}`, ''),
    ...(sale.tableCode ? [row(`Table: ${sale.tableCode}${sale.areaName ? ` (${sale.areaName})` : ''}`, '')] : []),
    '-'.repeat(42),
  ];
  for (const item of sale.items || []) {
    lines.push(`${plain(item.quantity)} x ${item.productName} (${item.unit})`);
    lines.push(row(`  ${asciiMoney(item.unitPrice)} each`, asciiMoney(item.lineTotal)));
  }
  lines.push('-'.repeat(42));
  lines.push(row('Subtotal', asciiMoney(sale.subtotal ?? sale.total)));
  if (Number(sale.discountAmount) > 0) lines.push(row('Discount', `-${asciiMoney(sale.discountAmount)}`));
  lines.push(row('TOTAL', asciiMoney(sale.total)));
  for (const payment of sale.payments || []) {
    lines.push(row(payment.method.replace('_', ' '), asciiMoney(payment.amount)));
  }
  if (Number(sale.balanceDue) > 0) lines.push(row('Balance due', asciiMoney(sale.balanceDue)));
  lines.push('-'.repeat(42));
  lines.push(center('Thank you for your business.'));
  lines.push('');
  lines.push(center(`${sale.reference} - ${created.toLocaleDateString()}`));
  return lines.join('\n');
}

export function downloadReceipt(sale, businessName = 'Umucyobar') {
  const text = buildReceiptText(sale, businessName);
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `receipt-${(sale.reference || 'sale').replace(/[^A-Za-z0-9-]/g, '')}.txt`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
