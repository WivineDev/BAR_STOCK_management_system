import { useEffect, useMemo, useState } from 'react';
import { Check, Minus, Plus, Search, ShoppingCart, Trash2, UserRoundPlus, X } from 'lucide-react';
import api from '../services/api.js';

const money = (n) => new Intl.NumberFormat('en-RW', { style: 'currency', currency: 'RWF', maximumFractionDigits: 0 }).format(Number(n || 0));

export default function PointOfSale() {
  const [products, setProducts] = useState([]); const [customers, setCustomers] = useState([]);
  const [cart, setCart] = useState([]); const [query, setQuery] = useState(''); const [payments, setPayments] = useState([{ method: 'cash', amount: '' }]);
  const [customerId, setCustomerId] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [receipt, setReceipt] = useState(null);
  const [showCustomer, setShowCustomer] = useState(false); const [customerForm, setCustomerForm] = useState({ name: '', phone: '' });
  async function loadProducts() { const { data } = await api.get('/pos/catalog'); setProducts(data.items); }
  async function loadCustomers() { const { data } = await api.get('/customers'); setCustomers(data.items); }
  useEffect(() => { Promise.all([loadProducts(), loadCustomers()]).catch(() => setError('Products or customers could not be loaded.')); }, []);
  const shown = products.filter((product) => `${product.name} ${product.sku || ''}`.toLowerCase().includes(query.toLowerCase()));
  const total = useMemo(() => cart.reduce((sum, line) => sum + Math.round(Number(line.unit.sellingPrice) * 100) * line.qty, 0), [cart]);
  const applied = payments.reduce((sum, line) => sum + Math.round(Number(line.amount || 0) * 100), 0);
  function add(product, unit) {
    const key = `${product.id}:${unit.id}`;
    setCart((current) => { const line = current.find((item) => item.key === key); return line ? current.map((item) => item.key === key ? { ...item, qty: item.qty + 1 } : item) : [...current, { key, product, unit, qty: 1 }]; });
  }
  function changeQty(key, delta) { setCart((current) => current.map((item) => item.key === key ? { ...item, qty: item.qty + delta } : item).filter((item) => item.qty > 0)); }
  async function finish(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const { data } = await api.post('/sales', { customerId: customerId || null, items: cart.map((item) => ({ productId: item.product.id, unitId: item.unit.id, quantity: item.qty })), payments: payments.filter((line) => line.amount).map(({ method, amount }) => ({ method, amount })) }, { headers: { 'Idempotency-Key': crypto.randomUUID() } });
      setReceipt(data.sale); setCart([]); setPayments([{ method: 'cash', amount: '' }]); setCustomerId(''); await loadProducts();
    } catch (err) { setError(err.response?.data?.error || 'Sale could not be completed.'); }
    finally { setBusy(false); }
  }
  async function saveCustomer(event) {
    event.preventDefault();
    try { const { data } = await api.post('/customers', customerForm); await loadCustomers(); setCustomerId(data.customer.id); setCustomerForm({ name: '', phone: '' }); setShowCustomer(false); }
    catch (err) { setError(err.response?.data?.error || 'Customer could not be saved.'); }
  }

  return <div className="content-page pos-page">
    <div className="page-heading"><div><div className="date-label">FAST CHECKOUT</div><h1>Point of sale</h1><p>Choose a bottle or package, then record its payment.</p></div><span className="pos-live"><i /> Sales are recorded live</span></div>
    {error && <div className="notice notice-error">{error}</div>}
    {receipt && <div className="notice notice-success"><Check size={17} /> Sale {receipt.reference} saved · total {money(receipt.total)} <button onClick={() => setReceipt(null)}>Dismiss</button></div>}
    <div className="pos-layout">
      <section className="panel product-picker"><div className="picker-head"><div><span className="section-label">PRODUCT CATALOGUE</span><h2>Choose items</h2></div><span className="result-count">{shown.length} products</span></div><div className="search-box pos-search"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search drinks or SKU" autoFocus /></div>
        <div className="picker-grid">{shown.map((product) => <article className="picker-card product-card" key={product.id}><span className="picker-product-icon">🍺</span><b>{product.name}</b><small>{product.stockQuantity} {product.baseUnit}s available</small><div className="unit-choice-list">{product.units.map((unit) => { const added = cart.find((item) => item.product.id === product.id && item.unit.id === unit.id)?.qty || 0; const inStock = Number(product.stockQuantity) >= (added + 1) * Number(unit.factorToBase); return <button type="button" className="unit-choice" key={unit.id} disabled={!inStock} onClick={() => add(product, unit)}><span>Add {unit.unitName}</span><b>{money(unit.sellingPrice)}</b></button>; })}</div></article>)}{!shown.length && <div className="picker-empty">No products match this search.</div>}</div>
      </section>
      <form className="panel cart-panel" onSubmit={finish}><div className="cart-heading"><div><span className="section-label">CURRENT ORDER</span><h2>Your basket <span>{cart.reduce((sum, item) => sum + item.qty, 0)}</span></h2></div><ShoppingCart size={19} /></div>
        {cart.length ? <div className="cart-lines">{cart.map((item) => <div className="cart-line" key={item.key}><div className="cart-line-icon">🍺</div><div className="cart-line-copy"><b>{item.product.name} · {item.unit.unitName}</b><small>{money(item.unit.sellingPrice)} each</small></div><div className="quantity-control"><button type="button" onClick={() => changeQty(item.key, -1)} aria-label="Decrease"><Minus size={13} /></button><b>{item.qty}</b><button type="button" disabled={Number(item.product.stockQuantity) < (item.qty + 1) * Number(item.unit.factorToBase)} onClick={() => changeQty(item.key, 1)} aria-label="Increase"><Plus size={13} /></button></div><button type="button" className="remove-item" onClick={() => setCart((current) => current.filter((line) => line.key !== item.key))} aria-label="Remove"><Trash2 size={15} /></button></div>)}</div> : <div className="cart-empty"><div className="empty-icon"><ShoppingCart size={20} /></div><b>Your basket is empty</b><span>Select a product package to start an order.</span></div>}
        <div className="cart-checkout"><div className="cart-total"><span>Total due</span><b>{money(total / 100)}</b></div>
          <label>Customer<select value={customerId} onChange={(event) => setCustomerId(event.target.value)}><option value="">Walk-in customer</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></label><button type="button" className="text-link" onClick={() => setShowCustomer(true)}><UserRoundPlus size={14} /> Add customer</button>
          <div className="pos-payment-lines">{payments.map((line, index) => <div className="pos-payment-line" key={index}><label>Amount applied<input type="number" min="0" step="0.01" value={line.amount} onChange={(event) => setPayments((current) => current.map((item, i) => i === index ? { ...item, amount: event.target.value } : item))} placeholder="Optional" /></label><label>Method<select value={line.method} onChange={(event) => setPayments((current) => current.map((item, i) => i === index ? { ...item, method: event.target.value } : item))}><option value="cash">Cash</option><option value="mobile_money">Mobile Money</option><option value="bank_transfer">Bank transfer</option><option value="card">Card</option></select></label>{payments.length > 1 && <button type="button" className="icon-button" aria-label="Remove payment" onClick={() => setPayments((current) => current.filter((_, i) => i !== index))}><X size={14} /></button>}</div>)}</div>
          {payments.length < 4 && <button type="button" className="text-link" onClick={() => setPayments((current) => [...current, { method: 'mobile_money', amount: '' }])}><Plus size={14} /> Add another payment method</button>}
          <div className="payment-balance"><span>Still due</span><b>{money(Math.max(0, total - applied) / 100)}</b></div>
          <button className="button button-primary checkout-button" disabled={!cart.length || busy}>{busy ? 'Saving sale…' : `Complete sale · ${money(total / 100)}`}</button><small className="checkout-note">Inventory and payment are committed together. Credit needs a customer.</small>
        </div>
      </form>
    </div>
    {showCustomer && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setShowCustomer(false)}><form className="modal" onSubmit={saveCustomer}><div className="modal-title"><div><span className="section-label">CUSTOMER BOOK</span><h2>Add customer</h2></div><button type="button" className="icon-button" onClick={() => setShowCustomer(false)} aria-label="Close"><X size={18} /></button></div><label>Full name<input required maxLength="160" value={customerForm.name} onChange={(event) => setCustomerForm({ ...customerForm, name: event.target.value })} /></label><label>Phone (optional)<input maxLength="40" value={customerForm.phone} onChange={(event) => setCustomerForm({ ...customerForm, phone: event.target.value })} /></label><div className="modal-actions"><button type="button" className="button button-quiet" onClick={() => setShowCustomer(false)}>Cancel</button><button className="button button-primary">Save customer</button></div></form></div>}
  </div>;
}
