import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, Printer, RotateCcw, Search, X } from 'lucide-react';
import api from '../services/api.js';
import { useAuth } from '../state/AuthContext.jsx';

const money = (n) => new Intl.NumberFormat('en-RW', { style: 'currency', currency: 'RWF', maximumFractionDigits: 0 }).format(Number(n || 0));
const cents = (value) => { const [whole, decimal = ''] = String(value ?? '0').split('.'); return BigInt(whole || '0') * 100n + BigInt(decimal.padEnd(2, '0').slice(0, 2)); };
const mills = (value) => { const [whole, decimal = ''] = String(value ?? '0').split('.'); return BigInt(whole || '0') * 1000n + BigInt(decimal.padEnd(3, '0').slice(0, 3)); };
const fromCents = (amount) => `${amount / 100n}.${String(amount % 100n).padStart(2, '0')}`;
const portion = (amount, part, total) => total === 0n ? 0n : (amount * part + total / 2n) / total;
const returnValue = (line, quantity) => {
  const part = mills(quantity); const sold = mills(line.quantity); const already = mills(line.returnedQuantity);
  const remainingQty = sold - already; const remainingValue = cents(line.lineTotal) - cents(line.returnedTotal);
  if (part === remainingQty) return remainingValue;
  const calculated = portion(cents(line.lineTotal), part, sold);
  return calculated > remainingValue ? remainingValue : calculated;
};
const canReturn = (user) => ['owner', 'manager', 'accountant'].includes(user?.role);

export default function Sales() {
  const { user } = useAuth();
  const [items, setItems] = useState([]); const [query, setQuery] = useState(''); const [sale, setSale] = useState(null); const [error, setError] = useState('');
  const [returnMode, setReturnMode] = useState(false); const [returnQuantities, setReturnQuantities] = useState({}); const [restock, setRestock] = useState({});
  const [refundMethod, setRefundMethod] = useState('mobile_money'); const [returnReason, setReturnReason] = useState(''); const [returnBusy, setReturnBusy] = useState(false); const [notice, setNotice] = useState('');
  async function load() { try { const { data } = await api.get('/sales'); setItems(data.items); setError(''); } catch { setError('Sales history could not be loaded.'); } }
  useEffect(() => { load(); }, []);
  async function openReceipt(id) {
    try { const { data } = await api.get(`/sales/${id}`); setSale(data.sale); setReturnMode(false); setError(''); }
    catch (err) { setError(err.response?.data?.error || 'Sale details could not be loaded.'); }
  }
  const filtered = items.filter((item) => `${item.reference} ${item.customerName}`.toLowerCase().includes(query.toLowerCase()));
  const selectedLines = useMemo(() => sale?.items.filter((line) => Number(returnQuantities[line.id] || 0) > 0).map((line) => ({
    saleItemId: line.id, quantity: String(returnQuantities[line.id]), restock: restock[line.id], amount: returnValue(line, returnQuantities[line.id]),
  })) || [], [sale, returnQuantities, restock]);
  const returnTotal = selectedLines.reduce((sum, line) => sum + line.amount, 0n);
  const currentDebt = cents(sale?.balanceDue || '0');
  const creditAmount = returnTotal < currentDebt ? returnTotal : currentDebt;
  const refundAmount = returnTotal - creditAmount;

  async function submitReturn(event) {
    event.preventDefault(); setReturnBusy(true); setError(''); setNotice('');
    try {
      const response = await api.post(`/sales/${sale.id}/returns`, {
        items: selectedLines.map(({ saleItemId, quantity, restock: accepted }) => ({ saleItemId, quantity, restock: accepted })),
        payments: refundAmount > 0n ? [{ method: refundMethod, amount: fromCents(refundAmount) }] : [], reason: returnReason,
      }, { headers: { 'Idempotency-Key': crypto.randomUUID() } });
      setNotice(`Return ${response.data.salesReturn.reference} recorded. Customer credit: ${money(response.data.salesReturn.creditApplied)}; refund: ${money(response.data.salesReturn.refundAmount)}.`);
      await load(); await openReceipt(sale.id); setReturnQuantities({}); setRestock({}); setReturnReason('');
    } catch (err) { setError(err.response?.data?.error || 'Return could not be recorded.'); }
    finally { setReturnBusy(false); }
  }

  return <div className="content-page">
    <div className="page-heading"><div><div className="date-label">TRANSACTION HISTORY</div><h1>Sales</h1><p>Review completed transactions, payment splits, receipts, and authorized returns.</p></div></div>
    {error && <div className="notice notice-error">{error}</div>}{notice && <div className="notice notice-success">{notice}</div>}
    <div className="table-toolbar"><div className="search-box"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search reference or customer" /></div><span className="result-count">{filtered.length} sales</span></div>
    <div className="panel table-panel"><div className="table-scroll"><table><thead><tr><th>REFERENCE</th><th>DATE</th><th>CUSTOMER</th><th>ORIGINAL</th><th>RETURNED</th><th>PAID</th><th>BALANCE</th><th>STATUS</th><th></th></tr></thead><tbody>{filtered.map((item) => <tr key={item.id}><td><b>{item.reference}</b></td><td>{new Date(item.createdAt).toLocaleString()}</td><td>{item.customerName}</td><td className="table-money">{money(item.total)}</td><td>{money(item.returnedTotal)}</td><td>{money(item.amountPaid)}</td><td>{money(item.balanceDue)}</td><td>{item.status?.replace('_', ' ') || item.paymentStatus}</td><td><button className="button button-small button-outline" onClick={() => openReceipt(item.id)}>Details <ArrowUpRight size={13} /></button></td></tr>)}</tbody></table>{!filtered.length && <div className="table-empty"><b>No matching sales</b><span>Completed transactions will appear here.</span></div>}</div></div>
    {sale && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setSale(null)}><div className="modal receipt-modal return-modal">
      <div className="modal-title no-print"><div><span className="section-label">SALE RECORD</span><h2>{sale.reference}</h2></div><button className="icon-button" onClick={() => setSale(null)} aria-label="Close"><X size={18} /></button></div>
      <div className="receipt-card"><div className="receipt-brand"><div className="brand-mark"><span>✦</span></div><div><b>barwise</b><small>SALES RECEIPT</small></div></div>
        <div className="receipt-meta"><span>{sale.reference}</span><span>{new Date(sale.createdAt).toLocaleString()}</span><span>Served by {sale.cashierName}</span><span>Customer: {sale.customerName}</span><span>Status: {sale.status?.replace('_', ' ')}</span></div><div className="receipt-divider" />
        <div className="receipt-lines">{sale.items.map((line) => <div className="receipt-line" key={line.id}><div><b>{line.productName}</b><small>{line.quantity} × {line.unit}{Number(line.returnedQuantity) > 0 ? ` · ${line.returnedQuantity} returned` : ''}</small></div><b>{money(line.lineTotal)}</b></div>)}</div>
        <div className="receipt-divider" /><div className="receipt-sum"><span>Original total</span><b>{money(sale.total)}</b></div>
        {sale.payments.map((payment, index) => <div className="receipt-payment" key={index}><span>{payment.method.replace('_', ' ')}</span><span>{money(payment.amount)}</span></div>)}
        {Number(sale.balanceDue) > 0 && <div className="receipt-balance"><span>Balance due</span><b>{money(sale.balanceDue)}</b></div>}
        {Number(sale.refundedAmount) > 0 && <div className="receipt-payment"><span>Refunds paid</span><span>{money(sale.refundedAmount)}</span></div>}
        {sale.returns?.map((item) => <div className="receipt-payment" key={item.id}><span>{item.reference} · {new Date(item.createdAt).toLocaleDateString()}</span><span>{money(item.total)} returned</span></div>)}
        <div className="receipt-thanks">Thank you for your business.</div>
      </div>
      {returnMode && canReturn(user) && <form className="return-form no-print" onSubmit={submitReturn}>
        <div className="purchase-form-heading"><div><span className="section-label">AUTHORIZED SALES RETURN</span><h2>Record returned items</h2></div><RotateCcw size={18} /></div>
        <div className="table-scroll"><table><thead><tr><th>ITEM</th><th>REMAINING</th><th>RETURN QTY</th><th>RESTOCK?</th><th>VALUE</th></tr></thead><tbody>{sale.items.map((line) => {
          const remaining = Math.max(0, Number(line.quantity) - Number(line.returnedQuantity)); const qty = returnQuantities[line.id] || '';
          return <tr key={line.id}><td>{line.productName} <small>{line.unit}</small></td><td>{remaining}</td><td><input type="number" min="0" max={remaining} step="0.001" value={qty} onChange={(event) => setReturnQuantities((current) => ({ ...current, [line.id]: event.target.value }))} /></td><td><select value={restock[line.id] === true ? 'yes' : restock[line.id] === false ? 'no' : ''} onChange={(event) => setRestock((current) => ({ ...current, [line.id]: event.target.value === '' ? undefined : event.target.value === 'yes' }))}><option value="">Choose condition</option><option value="yes">Accepted for sale</option><option value="no">Damaged / do not restock</option></select></td><td>{money(fromCents(returnValue(line, qty || '0')))}</td></tr>;
        })}</tbody></table></div>
        <label>Reason (optional)<input maxLength="500" value={returnReason} onChange={(event) => setReturnReason(event.target.value)} placeholder="Reason for return" /></label>
        <div className="return-summary"><div><span>Items returned</span><b>{money(fromCents(returnTotal))}</b></div><div><span>Customer balance credit</span><b>{money(fromCents(creditAmount))}</b></div><div><span>Refund due</span><b>{money(fromCents(refundAmount))}</b></div></div>
        {refundAmount > 0n && <label>Refund method<select value={refundMethod} onChange={(event) => setRefundMethod(event.target.value)}><option value="cash">Cash</option><option value="mobile_money">Mobile Money</option><option value="bank_transfer">Bank transfer</option><option value="card">Card</option></select><small>Cash refunds require your cash session to be open.</small></label>}
        {selectedLines.some((line) => typeof line.restock !== 'boolean') && <div className="notice notice-error">Choose whether each returned item can be put back into saleable stock.</div>}
        <div className="modal-actions"><button className="button button-quiet" type="button" onClick={() => setReturnMode(false)}>Cancel</button><button className="button button-primary" disabled={returnBusy || !selectedLines.length || selectedLines.some((line) => typeof line.restock !== 'boolean')}>{returnBusy ? 'Recording…' : 'Record return'}</button></div>
      </form>}
      <div className="modal-actions no-print">{canReturn(user) && !returnMode && sale.status !== 'returned' && sale.status !== 'voided' && <button className="button button-outline" onClick={() => { setReturnQuantities({}); setRestock({}); setReturnMode(true); }}><RotateCcw size={15} /> Start return</button>}<button className="button button-quiet" onClick={() => setSale(null)}>Close</button><button className="button button-primary" onClick={() => window.print()}><Printer size={15} /> Print receipt</button></div>
    </div></div>}
  </div>;
}
