import { useEffect, useMemo, useState } from 'react';
import { Eye, PackagePlus, Plus, RotateCcw, X } from 'lucide-react';
import api from '../services/api.js';
import { useAuth } from '../state/AuthContext.jsx';
import TablePagination from '../components/TablePagination.jsx';

const money = (n) => new Intl.NumberFormat('en-RW', { style: 'currency', currency: 'RWF', maximumFractionDigits: 0 }).format(Number(n || 0));
const cents = (value) => { const [whole, decimal = ''] = String(value ?? '0').split('.'); return BigInt(whole || '0') * 100n + BigInt(decimal.padEnd(2, '0').slice(0, 2)); };
const mills = (value) => { const [whole, decimal = ''] = String(value ?? '0').split('.'); return BigInt(whole || '0') * 1000n + BigInt(decimal.padEnd(3, '0').slice(0, 3)); };
const fromCents = (amount) => `${amount / 100n}.${String(amount % 100n).padStart(2, '0')}`;
const portion = (amount, part, total) => total === 0n ? 0n : (amount * part + total / 2n) / total;
const returnValue = (line, quantity) => {
  const part = mills(quantity); const purchased = mills(line.quantity); const already = mills(line.returnedQuantity);
  const remainingQty = purchased - already; const remainingValue = cents(line.lineTotal) - cents(line.returnedTotal);
  if (part === remainingQty) return remainingValue;
  const calculated = portion(cents(line.lineTotal), part, purchased);
  return calculated > remainingValue ? remainingValue : calculated;
};
const newLine = () => ({ productId: '', unitId: '', quantity: '1', unitCost: '', sellingPrice: '', units: [] });
const canReturn = (user) => ['owner', 'manager', 'storekeeper', 'accountant'].includes(user?.role);

export default function Purchases() {
  const { user } = useAuth();
  const [products, setProducts] = useState([]); const [suppliers, setSuppliers] = useState([]); const [purchases, setPurchases] = useState([]);
  const [page, setPage] = useState(1); const [limit, setLimit] = useState(10); const [meta, setMeta] = useState({ page: 1, limit: 10, totalRecords: 0, totalPages: 0 });
  const [lines, setLines] = useState([newLine()]); const [supplierId, setSupplierId] = useState(''); const [payment, setPayment] = useState(''); const [paymentEdited, setPaymentEdited] = useState(false); const [method, setMethod] = useState('cash');
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [purchase, setPurchase] = useState(null); const [returnMode, setReturnMode] = useState(false); const [returnQuantities, setReturnQuantities] = useState({});
  const [refundMethod, setRefundMethod] = useState('mobile_money'); const [returnReason, setReturnReason] = useState(''); const [returnBusy, setReturnBusy] = useState(false);
  async function load() {
    try { const [p, s, h] = await Promise.all([api.get('/products', { params: { limit: 100 } }), api.get('/suppliers', { params: { limit: 100 } }), api.get('/purchases', { params: { page, limit } })]); setProducts(p.data.items); setSuppliers(s.data.items); setPurchases(h.data.items); setMeta(h.data.meta); setPage(h.data.meta.page); }
    catch { setError('Purchase workspace could not be loaded.'); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [page, limit]);
  async function chooseProduct(index, productId) {
    const row = products.find((item) => item.id === productId); const next = [...lines];
    if (!row) { next[index] = newLine(); setLines(next); return; }
    try {
      const { data } = await api.get(`/products/${productId}/units`);
      if (!data.items.length) {
        next[index] = { ...next[index], productId, unitId: '', units: [], unitCost: '', sellingPrice: '' };
        setLines(next);
        setError('This product has no active packaging unit. Re-run the sample-data seed to repair demo products.');
        return;
      }
      const base = data.items.find((unit) => Number(unit.isBase) === 1) || data.items[0];
      next[index] = { ...next[index], productId, units: data.items, unitId: base?.id || '', unitCost: base?.purchasePrice || row.costPrice, sellingPrice: base?.sellingPrice ?? '' }; setLines(next); setError('');
    } catch (err) { setError(err.response?.data?.error || 'Packaging units could not be loaded.'); }
  }
  function updateLine(index, field, value) { setLines((current) => current.map((line, i) => i === index ? { ...line, [field]: value } : line)); }
  function chooseUnit(index, unitId) { const unit = lines[index].units.find((item) => item.id === unitId); setLines((current) => current.map((item, i) => i === index ? { ...item, unitId, unitCost: unit?.purchasePrice || '', sellingPrice: unit?.sellingPrice ?? '' } : item)); }
  const estimatedTotal = lines.reduce((sum, line) => sum + Math.round(Number(line.unitCost || 0) * 100) * Number(line.quantity || 0), 0) / 100;
  useEffect(() => {
    if (!paymentEdited) setPayment(estimatedTotal > 0 ? estimatedTotal.toFixed(2) : '');
  }, [estimatedTotal, paymentEdited]);
  const selectedLines = useMemo(() => purchase?.items.filter((line) => Number(returnQuantities[line.id] || 0) > 0).map((line) => ({ purchaseItemId: line.id, quantity: String(returnQuantities[line.id]), amount: returnValue(line, returnQuantities[line.id]) })) || [], [purchase, returnQuantities]);
  const returnTotal = selectedLines.reduce((sum, line) => sum + line.amount, 0n);
  const payable = cents(purchase?.balanceDue || '0'); const payableCredit = returnTotal < payable ? returnTotal : payable; const supplierRefund = returnTotal - payableCredit;

  async function receive(event) {
    event.preventDefault();
    if (lines.some((line) => line.productId && !line.unitId)) { setError('Every selected product needs an active packaging unit before receiving stock.'); return; }
    setBusy(true); setError(''); setNotice('');
    try {
      const validLines = lines.filter((line) => line.productId).map(({ productId, unitId, quantity, unitCost, sellingPrice }) => ({ productId, unitId, quantity, unitCost, sellingPrice }));
      const { data } = await api.post('/purchases', { supplierId, items: validLines, payments: payment ? [{ method, amount: payment }] : [] });
      setNotice(`Purchase ${data.purchase.reference} received · ${money(data.purchase.total)}`); setLines([newLine()]); setSupplierId(''); setPayment(''); setPaymentEdited(false); await load();
    } catch (err) { setError(err.response?.data?.error || 'Purchase could not be received.'); }
    finally { setBusy(false); }
  }
  async function openPurchase(id) {
    try { const { data } = await api.get(`/purchases/${id}`); setPurchase(data.purchase); setReturnMode(false); setError(''); }
    catch (err) { setError(err.response?.data?.error || 'Purchase details could not be loaded.'); }
  }
  async function submitReturn(event) {
    event.preventDefault(); setReturnBusy(true); setError(''); setNotice('');
    try {
      const response = await api.post(`/purchases/${purchase.id}/returns`, {
        items: selectedLines.map(({ purchaseItemId, quantity }) => ({ purchaseItemId, quantity })),
        payments: supplierRefund > 0n ? [{ method: refundMethod, amount: fromCents(supplierRefund) }] : [], reason: returnReason,
      }, { headers: { 'Idempotency-Key': crypto.randomUUID() } });
      setNotice(`Return ${response.data.purchaseReturn.reference} recorded. Supplier balance credit: ${money(response.data.purchaseReturn.payableCredit)}; refund received: ${money(response.data.purchaseReturn.refundReceived)}.`);
      await load(); await openPurchase(purchase.id); setReturnQuantities({}); setReturnReason('');
    } catch (err) { setError(err.response?.data?.error || 'Purchase return could not be recorded.'); }
    finally { setReturnBusy(false); }
  }

  return <div className="content-page">
    <div className="page-heading"><div><div className="date-label">STOCK RECEIVING</div><h1>Purchases</h1><p>Receive deliveries, update stock, and keep supplier balances current.</p></div></div>
    {error && <div className="notice notice-error">{error}</div>}{notice && <div className="notice notice-success">{notice}</div>}
    <form className="panel purchase-form" onSubmit={receive}><div className="purchase-form-heading"><div><span className="section-label">NEW DELIVERY</span><h2>Receive stock</h2></div><PackagePlus size={18} /></div>
      {!suppliers.length ? <div className="notice notice-error">Add a supplier before recording a purchase. <a href="/suppliers">Open suppliers</a></div> : <label>Supplier<select required value={supplierId} onChange={(event) => setSupplierId(event.target.value)}><option value="">Select supplier</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></label>}
      <div className="purchase-lines">{lines.map((line, index) => <div className="purchase-line" key={index}><label>Product<select required value={line.productId} onChange={(event) => chooseProduct(index, event.target.value)}><option value="">Choose product</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name} · {product.stockQuantity} {product.baseUnit}s</option>)}</select></label><label>Packaging unit<select required value={line.unitId} onChange={(event) => chooseUnit(index, event.target.value)} disabled={!line.units.length}><option value="">Select unit</option>{line.units.map((unit) => <option key={unit.id} value={unit.id}>{unit.unitName} · {unit.factorToBase} base units</option>)}</select></label><label>Quantity<input type="number" min="0.001" step="0.001" required value={line.quantity} onChange={(event) => updateLine(index, 'quantity', event.target.value)} /></label><label>Unit cost (RWF)<input type="number" min="0" step="0.01" required value={line.unitCost} onChange={(event) => updateLine(index, 'unitCost', event.target.value)} /></label><label>Selling price (RWF)<input type="number" min="0" step="0.01" required value={line.sellingPrice} onChange={(event) => updateLine(index, 'sellingPrice', event.target.value)} /></label><button type="button" className="icon-button purchase-remove" aria-label="Remove line" disabled={lines.length === 1} onClick={() => setLines((current) => current.filter((_, i) => i !== index))}><X size={16} /></button></div>)}</div>
      <button className="text-link" type="button" onClick={() => setLines((current) => [...current, newLine()])}><Plus size={14} /> Add product line</button>
      <div className="purchase-footer"><div className="purchase-payment"><label>Amount paid now (RWF)<input type="number" min="0" step="0.01" value={payment} onChange={(event) => { setPayment(event.target.value); setPaymentEdited(true); }} placeholder="Leave blank to record supplier debt" /></label><label>Payment method<select value={method} onChange={(event) => setMethod(event.target.value)}><option value="cash">Cash</option><option value="mobile_money">Mobile Money</option><option value="bank_transfer">Bank transfer</option><option value="card">Card</option></select></label></div><div className="purchase-total"><span>Estimated total</span><b>{money(estimatedTotal)}</b><small>Amount paid fills from the purchase total; edit it for a partial payment or leave blank for supplier debt. Stock is received as soon as this purchase commits.</small><button className="button button-primary" disabled={busy || loading || !suppliers.length || !products.length}>{busy ? 'Receiving…' : 'Confirm purchase'}</button></div></div>
    </form>
    <div className="panel table-panel purchase-history"><div className="panel-heading padded-heading"><div><span className="section-label">SUPPLY RECORD</span><h2>Recent purchases</h2></div><span className="result-count">{meta.totalRecords} records</span></div><div className="table-scroll"><table><thead><tr><th>#</th><th>REFERENCE</th><th>DATE</th><th>SUPPLIER</th><th>TOTAL</th><th>PAID</th><th>BALANCE DUE</th><th></th></tr></thead><tbody>{purchases.map((item, index) => <tr key={item.id}><td>{(page - 1) * limit + index + 1}</td><td><b>{item.reference}</b></td><td>{new Date(item.createdAt).toLocaleDateString()}</td><td>{item.supplierName}</td><td className="table-money">{money(item.total)}</td><td>{money(item.amountPaid)}</td><td className="table-money">{money(item.balanceDue)}</td><td><button className="button button-small button-outline" onClick={() => openPurchase(item.id)}><Eye size={13} /> Details</button></td></tr>)}</tbody></table>{!purchases.length && <div className="table-empty"><div className="empty-icon"><PackagePlus size={18} /></div><b>No purchases recorded</b><span>Received deliveries will appear here.</span></div>}</div><TablePagination page={page} meta={meta} limit={limit} onPageChange={setPage} onLimitChange={(value) => { setLimit(value); setPage(1); }} /></div>
    {purchase && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setPurchase(null)}><div className="modal receipt-modal return-modal"><div className="modal-title no-print"><div><span className="section-label">PURCHASE RECORD · {purchase.supplierName}</span><h2>{purchase.reference}</h2></div><button className="icon-button" onClick={() => setPurchase(null)} aria-label="Close"><X size={18} /></button></div>
      <div className="receipt-card"><div className="receipt-meta"><span>{purchase.reference}</span><span>{new Date(purchase.createdAt).toLocaleString()}</span><span>Supplier: {purchase.supplierName}</span><span>Purchase balance: {money(purchase.balanceDue)}</span></div><div className="receipt-divider" /><div className="receipt-lines">{purchase.items.map((line) => <div className="receipt-line" key={line.id}><div><b>{line.productName}</b><small>{line.quantity} × {line.unit}{Number(line.returnedQuantity) > 0 ? ` · ${line.returnedQuantity} returned` : ''}</small></div><b>{money(line.lineTotal)}</b></div>)}</div><div className="receipt-divider" /><div className="receipt-sum"><span>Purchase total</span><b>{money(purchase.total)}</b></div>{purchase.returns?.map((item) => <div className="receipt-payment" key={item.id}><span>{item.reference} · {new Date(item.createdAt).toLocaleDateString()}</span><span>{money(item.total)} returned</span></div>)}</div>
      {returnMode && canReturn(user) && <form className="return-form no-print" onSubmit={submitReturn}><div className="purchase-form-heading"><div><span className="section-label">PURCHASE RETURN</span><h2>Return items to supplier</h2></div><RotateCcw size={18} /></div>
        <div className="table-scroll"><table><thead><tr><th>ITEM</th><th>REMAINING</th><th>RETURN QTY</th><th>VALUE</th></tr></thead><tbody>{purchase.items.map((line) => { const remaining = Math.max(0, Number(line.quantity) - Number(line.returnedQuantity)); const qty = returnQuantities[line.id] || ''; return <tr key={line.id}><td>{line.productName} <small>{line.unit}</small></td><td>{remaining}</td><td><input type="number" min="0" max={remaining} step="0.001" value={qty} onChange={(event) => setReturnQuantities((current) => ({ ...current, [line.id]: event.target.value }))} /></td><td>{money(fromCents(returnValue(line, qty || '0')))}</td></tr>; })}</tbody></table></div>
        <label>Reason (optional)<input maxLength="500" value={returnReason} onChange={(event) => setReturnReason(event.target.value)} placeholder="Reason for purchase return" /></label>
        <div className="return-summary"><div><span>Items returned</span><b>{money(fromCents(returnTotal))}</b></div><div><span>Supplier balance credit</span><b>{money(fromCents(payableCredit))}</b></div><div><span>Refund to receive now</span><b>{money(fromCents(supplierRefund))}</b></div></div>
        {supplierRefund > 0n && <label>Refund method<select value={refundMethod} onChange={(event) => setRefundMethod(event.target.value)}><option value="cash">Cash</option><option value="mobile_money">Mobile Money</option><option value="bank_transfer">Bank transfer</option><option value="card">Card</option></select><small>Cash refunds require your cash session to be open.</small></label>}
        <div className="modal-actions"><button className="button button-quiet" type="button" onClick={() => setReturnMode(false)}>Cancel</button><button className="button button-primary" disabled={returnBusy || !selectedLines.length}>{returnBusy ? 'Recording…' : 'Record return'}</button></div>
      </form>}
      <div className="modal-actions no-print">{canReturn(user) && purchase.status === 'received' && !returnMode && <button className="button button-outline" onClick={() => { setReturnQuantities({}); setReturnMode(true); }}><RotateCcw size={15} /> Start return</button>}<button className="button button-quiet" onClick={() => setPurchase(null)}>Close</button></div>
    </div></div>}
  </div>;
}
