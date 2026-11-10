import { Beer } from 'lucide-react';

const money = (n) => new Intl.NumberFormat('en-RW', { style: 'currency', currency: 'RWF', maximumFractionDigits: 0 }).format(Number(n || 0));

export default function ReceiptCard({ sale, businessName = 'Umucyobar' }) {
  if (!sale) return null;
  return (
    <div className="receipt-card">
      <div className="receipt-brand">
        <div className="brand-mark"><Beer size={15} /></div>
        <div><b>{businessName}</b><small>SALES RECEIPT</small></div>
      </div>
      <div className="receipt-meta">
        <span>{sale.reference}</span>
        <span>{new Date(sale.createdAt).toLocaleString()}</span>
        <span>Served by {sale.cashierName}</span>
        <span>Customer: {sale.customerName || 'Walk-in customer'}</span>
        {sale.tableCode && <span>Table {sale.tableCode}{sale.areaName ? ` · ${sale.areaName}` : ''}</span>}
        <span>Status: {(sale.status || 'completed').replace('_', ' ')}</span>
      </div>
      <div className="receipt-divider" />
      <div className="receipt-lines">
        {sale.items.map((line) => (
          <div className="receipt-line" key={line.id}>
            <div>
              <b>{line.productName}</b>
              <small>{line.quantity} × {line.unit}{Number(line.returnedQuantity) > 0 ? ` · ${line.returnedQuantity} returned` : ''}</small>
            </div>
            <b>{money(line.lineTotal)}</b>
          </div>
        ))}
      </div>
      <div className="receipt-divider" />
      <div className="receipt-sum"><span>Subtotal</span><b>{money(sale.subtotal ?? sale.total)}</b></div>
      {Number(sale.discountAmount) > 0 && <div className="receipt-payment receipt-discount-row"><span>Discount</span><span>−{money(sale.discountAmount)}</span></div>}
      <div className="receipt-sum"><span>Total</span><b>{money(sale.total)}</b></div>
      {(sale.payments || []).map((payment, index) => (
        <div className="receipt-payment" key={index}><span>{payment.method.replace('_', ' ')}</span><span>{money(payment.amount)}</span></div>
      ))}
      {Number(sale.balanceDue) > 0 && <div className="receipt-balance"><span>Balance due</span><b>{money(sale.balanceDue)}</b></div>}
      {Number(sale.refundedAmount) > 0 && <div className="receipt-payment"><span>Refunds paid</span><span>{money(sale.refundedAmount)}</span></div>}
      {(sale.returns || []).map((item) => (
        <div className="receipt-payment" key={item.id}><span>{item.reference} · {new Date(item.createdAt).toLocaleDateString()}</span><span>{money(item.total)} returned</span></div>
      ))}
      <div className="receipt-thanks">Thank you for your business.</div>
    </div>
  );
}
