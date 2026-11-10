import { useEffect, useMemo, useState } from 'react';
import {
  Armchair, BadgePercent, Banknote, Barcode, Beer, Check, Clock, CreditCard, Download, LayoutGrid, Loader2,
  Minus, Pause, Play, Plus, Printer, Search, ShoppingCart, Store, Trash2, UserRoundPlus, Users, UtensilsCrossed, X,
} from 'lucide-react';
import api from '../services/api.js';
import { useAuth } from '../state/AuthContext.jsx';
import ReceiptCard from '../components/ReceiptCard.jsx';
import { downloadReceipt } from '../utils/receipt.js';

const money = (n) => new Intl.NumberFormat('en-RW', { style: 'currency', currency: 'RWF', maximumFractionDigits: 0 }).format(Number(n || 0));
const cents = (value) => { const parsed = Number(value); return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0; };
const maxQtyFor = (line) => { const factor = Number(line.unit.factorToBase) || 1; const stock = Number(line.product.stockQuantity) || 0; return Math.floor((stock / factor) * 1000) / 1000; };
const elapsed = (from) => { const minutes = Math.max(0, Math.floor((Date.now() - new Date(from).getTime()) / 60000)); return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`; };

export default function PointOfSale() {
  const { user } = useAuth();
  const businessName = user?.businessName || 'Umucyobar';
  const canDiscount = ['owner', 'manager'].includes(user?.role);
  const canManage = ['owner', 'manager'].includes(user?.role);

  const [products, setProducts] = useState([]); const [customers, setCustomers] = useState([]); const [users, setUsers] = useState([]);
  const [cart, setCart] = useState([]); const [qtyDrafts, setQtyDrafts] = useState({});
  const [query, setQuery] = useState(''); const [activeCategory, setActiveCategory] = useState('');
  const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [busy, setBusy] = useState(false);

  const [mode, setMode] = useState('walkin');
  const [sessionId, setSessionId] = useState('');
  const [session, setSession] = useState(null);
  const [openSessions, setOpenSessions] = useState([]); const [floorTables, setFloorTables] = useState([]);
  const [payForm, setPayForm] = useState(null); const [closeForm, setCloseForm] = useState(null);
  const [voidTarget, setVoidTarget] = useState(null); const [transferForm, setTransferForm] = useState(null);

  const [payments, setPayments] = useState([{ method: 'cash', amount: '', autoFill: true }]);
  const [discountInput, setDiscountInput] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [receipt, setReceipt] = useState(null);
  const [showCustomer, setShowCustomer] = useState(false); const [customerForm, setCustomerForm] = useState({ name: '', phone: '' });
  const [held, setHeld] = useState([]); const [showHeld, setShowHeld] = useState(false); const [holdLabel, setHoldLabel] = useState('');

  async function loadProducts() { const { data } = await api.get('/pos/catalog'); setProducts(data.items); }
  async function loadCustomers() { const { data } = await api.get('/customers'); setCustomers(data.items); }
  async function loadFloor() { const { data } = await api.get('/floor'); setFloorTables(data.tables); }
  async function loadOpenSessions() { const { data } = await api.get('/table-sessions/open'); setOpenSessions(data.sessions); }
  async function loadSession(id) {
    try { const { data } = await api.get(`/table-sessions/${id}`); setSession(data.session); setError(''); }
    catch { setSessionId(''); setSession(null); setError('That table session is no longer open.'); }
  }
  async function refreshSession() { if (sessionId) await loadSession(sessionId); await Promise.all([loadProducts(), loadOpenSessions(), loadFloor()]); }

  useEffect(() => {
    const param = new URLSearchParams(window.location.search).get('session');
    Promise.all([loadProducts(), loadCustomers(), loadFloor(), loadOpenSessions()]).catch(() => setError('Products or customers could not be loaded.'));
    if (param) { setMode('table'); setSessionId(param); loadSession(param); }
    api.get('/floor/staff').then(({ data }) => setUsers(data.items)).catch(() => {});
  }, []);

  const categories = useMemo(() => { const found = new Set(); products.forEach((product) => { if (product.categoryName) found.add(product.categoryName); }); return [...found].sort(); }, [products]);
  const shown = products.filter((product) => `${product.name} ${product.sku || ''}`.toLowerCase().includes(query.trim().toLowerCase()) && (!activeCategory || product.categoryName === activeCategory));

  const subtotal = useMemo(() => cart.reduce((sum, line) => sum + Math.round(Number(line.unit.sellingPrice) * 100) * line.qty, 0), [cart]);
  const discount = canDiscount ? Math.min(Math.max(0, cents(discountInput)), subtotal) : 0;
  const total = subtotal - discount;
  const defaultPayment = total > 0 ? String(total / 100) : '';
  const effectivePayments = payments.map((line) => ({ method: line.method, amount: line.autoFill ? defaultPayment : line.amount }));
  const applied = effectivePayments.reduce((sum, line) => sum + cents(line.amount), 0);

  function switchMode(next) {
    setMode(next); setCart([]); setQtyDrafts({}); setError(''); setNotice('');
    if (next === 'walkin') { setSessionId(''); setSession(null); window.history.replaceState({}, '', '/pos'); }
  }
  function pickSession(id) { setMode('table'); setSessionId(id); setSession(null); loadSession(id); window.history.replaceState({}, '', `/pos?session=${id}`); }
  function releaseSession() { setSessionId(''); setSession(null); window.history.replaceState({}, '', '/pos'); loadOpenSessions(); loadFloor(); }

  function add(product, unit) {
    const key = `${product.id}:${unit.id}`;
    setCart((current) => {
      const line = current.find((item) => item.key === key);
      const next = line ? current.map((item) => (item.key === key ? { ...item, qty: item.qty + 1 } : item)) : [...current, { key, product, unit, qty: 1 }];
      const capped = next.map((item) => (item.key === key ? { ...item, qty: Math.min(item.qty, maxQtyFor(item)) } : item));
      setQtyDrafts((drafts) => ({ ...drafts, [key]: String(capped.find((item) => item.key === key).qty) }));
      return capped;
    });
  }
  function changeQty(key, delta) {
    setCart((current) => current.map((item) => {
      if (item.key !== key) return item;
      const next = Math.max(1, Math.min(item.qty + delta, maxQtyFor(item)));
      setQtyDrafts((drafts) => ({ ...drafts, [key]: String(next) }));
      return { ...item, qty: next };
    }));
  }
  function typeQty(key, value) {
    setQtyDrafts((drafts) => ({ ...drafts, [key]: value }));
    const parsed = Number(value);
    if (value.trim() !== '' && Number.isFinite(parsed) && parsed > 0) setCart((current) => current.map((item) => (item.key === key ? { ...item, qty: parsed } : item)));
  }
  function commitQty(key) {
    setCart((current) => current.map((item) => {
      if (item.key !== key) return item;
      const parsed = Number(qtyDrafts[key]);
      const next = Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, maxQtyFor(item)) : 1;
      setQtyDrafts((drafts) => ({ ...drafts, [key]: String(next) }));
      return { ...item, qty: next };
    }));
  }
  function removeLine(key) {
    setCart((current) => current.filter((line) => line.key !== key));
    setQtyDrafts((drafts) => { const next = { ...drafts }; delete next[key]; return next; });
  }
  function applyDiscountPercent(percent) { setDiscountInput(String(Math.round((subtotal * percent) / 100) / 100)); }
  function searchKeyDown(event) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const term = query.trim().toLowerCase();
    if (!term) return;
    const target = products.find((product) => (product.sku || '').toLowerCase() === term) || (shown.length === 1 ? shown[0] : null);
    if (!target || !target.units.length) return;
    add(target, target.units[0]); setQuery('');
  }

  async function finish(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const { data } = await api.post('/sales', {
        customerId: customerId || null,
        items: cart.map((item) => ({ productId: item.product.id, unitId: item.unit.id, quantity: String(Math.min(item.qty, maxQtyFor(item))) })),
        discount: discount > 0 ? String(discount / 100) : '0',
        payments: effectivePayments.filter((line) => line.amount !== '' && line.amount !== undefined).map(({ method, amount }) => ({ method, amount })),
      }, { headers: { 'Idempotency-Key': crypto.randomUUID() } });
      const detail = await api.get(`/sales/${data.sale.id}`);
      setReceipt(detail.data.sale);
      setCart([]); setQtyDrafts({}); setDiscountInput(''); setCustomerId(''); setQuery(''); setActiveCategory('');
      setPayments([{ method: 'cash', amount: '', autoFill: true }]);
      await loadProducts();
    } catch (err) { setError(err.response?.data?.error || 'Sale could not be completed.'); }
    finally { setBusy(false); }
  }

  async function saveCustomer(event) {
    event.preventDefault();
    try { const { data } = await api.post('/customers', customerForm); await loadCustomers(); setCustomerId(data.customer.id); setCustomerForm({ name: '', phone: '' }); setShowCustomer(false); }
    catch (err) { setError(err.response?.data?.error || 'Customer could not be saved.'); }
  }

  async function openTable(tableId) {
    setBusy(true); setError('');
    try { const { data } = await api.post(`/floor/tables/${tableId}/sessions`); pickSession(data.session.id); }
    catch (err) { setError(err.response?.data?.error || 'The table could not be opened.'); }
    finally { setBusy(false); }
  }

  async function sendRound(serveNow) {
    if (!cart.length) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await api.post(`/table-sessions/${sessionId}/orders`, {
        items: cart.map((item) => ({ productId: item.product.id, unitId: item.unit.id, quantity: String(Math.min(item.qty, maxQtyFor(item))) })),
        serveNow,
      }, { headers: { 'Idempotency-Key': crypto.randomUUID() } });
      setCart([]); setQtyDrafts({});
      setNotice(serveNow ? 'Round served — stock has been deducted once.' : 'Round saved as draft — stock is untouched until you serve it.');
      await refreshSession();
    } catch (err) { setError(err.response?.data?.error || 'The round could not be saved.'); }
    finally { setBusy(false); }
  }

  async function serveDraft(order) {
    setBusy(true); setError(''); setNotice('');
    try { await api.post(`/orders/${order.id}/serve`); setNotice(`Round ${order.roundNo} served.`); await refreshSession(); }
    catch (err) { setError(err.response?.data?.error || 'The round could not be served.'); }
    finally { setBusy(false); }
  }

  async function voidRound(event) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      await api.post(`/orders/${voidTarget.id}/void`, { reason: voidTarget.reason });
      setVoidTarget(null); setNotice('Round voided.'); await refreshSession();
    } catch (err) { setError(err.response?.data?.error || 'The round could not be voided.'); }
    finally { setBusy(false); }
  }

  async function takePayment(event) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      await api.post(`/table-sessions/${sessionId}/payments`, { method: payForm.method, amount: payForm.amount }, { headers: { 'Idempotency-Key': crypto.randomUUID() } });
      setPayForm(null); setNotice('Payment recorded.'); await refreshSession();
    } catch (err) { setError(err.response?.data?.error || 'The payment could not be recorded.'); }
    finally { setBusy(false); }
  }

  async function closeTable(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const { data } = await api.post(`/table-sessions/${sessionId}/close`, {
        discount: closeForm.discount || '0',
        customerId: closeForm.customerId || null,
      }, { headers: { 'Idempotency-Key': crypto.randomUUID() } });
      const detail = await api.get(`/sales/${data.sale.id}`);
      setReceipt(detail.data.sale); setCloseForm(null); releaseSession(); await loadProducts();
    } catch (err) { setError(err.response?.data?.error || 'The table could not be closed.'); }
    finally { setBusy(false); }
  }

  async function assignWaiter(waiterId) {
    setBusy(true); setError('');
    try { await api.patch(`/table-sessions/${sessionId}/waiter`, { waiterId }); await refreshSession(); }
    catch (err) { setError(err.response?.data?.error || 'The waiter could not be assigned.'); }
    finally { setBusy(false); }
  }

  async function transferTable(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      await api.post(`/table-sessions/${sessionId}/transfer`, { targetTableId: transferForm.targetTableId, reason: transferForm.reason }, { headers: { 'Idempotency-Key': crypto.randomUUID() } });
      setTransferForm(null); setNotice('Table transferred.'); await refreshSession();
    } catch (err) { setError(err.response?.data?.error || 'The table could not be transferred.'); }
    finally { setBusy(false); }
  }

  async function loadHeld() { const { data } = await api.get('/held-sales'); setHeld(data.items); setShowHeld(true); }
  async function holdCart() {
    if (!cart.length) return;
    setBusy(true); setError('');
    try {
      await api.post('/held-sales', { label: holdLabel.trim() || `Cart ${new Date().toLocaleTimeString()}`, items: cart.map((item) => ({ productId: item.product.id, unitId: item.unit.id, quantity: String(item.qty) })) });
      setCart([]); setQtyDrafts({}); setHoldLabel(''); setNotice('Cart held. Resume it any time before checkout.');
    } catch (err) { setError(err.response?.data?.error || 'The cart could not be held.'); }
    finally { setBusy(false); }
  }
  async function resumeHeld(item) {
    setBusy(true); setError('');
    try {
      const lines = item.items.map((line) => {
        const product = products.find((p) => p.id === line.productId);
        const unit = product?.units.find((u) => u.id === line.productUnitId);
        return product && unit ? { key: `${product.id}:${unit.id}`, product, unit, qty: Number(line.quantity) } : null;
      }).filter(Boolean);
      if (lines.length) setCart((current) => [...current, ...lines.filter((line) => !current.some((existing) => existing.key === line.key))]);
      await api.delete(`/held-sales/${item.id}`);
      setShowHeld(false); setNotice('Held cart resumed.');
    } catch (err) { setError(err.response?.data?.error || 'The held cart could not be resumed.'); }
    finally { setBusy(false); }
  }
  async function discardHeld(item) {
    try { await api.delete(`/held-sales/${item.id}`); setHeld((current) => current.filter((entry) => entry.id !== item.id)); }
    catch (err) { setError(err.response?.data?.error || 'The held cart could not be discarded.'); }
  }

  const sessionBill = session ? Number(session.billTotal) : 0;
  const sessionPaid = session ? Number(session.paidTotal) : 0;
  const sessionBalance = sessionBill - sessionPaid;

  return <div className="content-page pos-page">
    <div className="page-heading">
      <div><div className="date-label">FAST CHECKOUT</div><h1>Point of sale</h1><p>Pick a channel: quick walk-in sales, or open table service with running bills.</p></div>
      <div className="pos-mode-switch" role="tablist" aria-label="Service channel">
        <button type="button" role="tab" aria-selected={mode === 'walkin'} className={`pos-mode ${mode === 'walkin' ? 'active' : ''}`} onClick={() => switchMode('walkin')}><Store size={15} /> Walk-in</button>
        <button type="button" role="tab" aria-selected={mode === 'table'} className={`pos-mode ${mode === 'table' ? 'active' : ''}`} onClick={() => switchMode('table')}><UtensilsCrossed size={15} /> Table service</button>
      </div>
    </div>
    {error && <div className="notice notice-error">{error}</div>}
    {notice && <div className="notice notice-success"><Check size={14} /> {notice}</div>}

    {mode === 'table' && !session && <section className="panel session-picker">
      <div className="panel-heading padded-heading"><div><span className="section-label">TABLE SERVICE</span><h2>Choose a table</h2></div><span className="result-count">{openSessions.length} open</span></div>
      <div className="session-picker-grid">
        {floorTables.filter((table) => table.active && table.effectiveStatus === 'occupied').map((table) => (
          <button type="button" className="session-pick-card occupied" key={table.sessionId} onClick={() => pickSession(table.sessionId)}>
            <div className="session-pick-head"><b>{table.code}</b><span className="table-status-pill status-occupied">Occupied</span></div>
            <small>{table.areaName || 'Floor'} · {elapsed(table.openedAt)}</small>
            <div className="session-pick-bill"><span>Bill {money(table.billTotal)}</span><b>{Number(table.billTotal) - Number(table.paidTotal) > 0 ? `${money(Number(table.billTotal) - Number(table.paidTotal))} due` : 'Settled'}</b></div>
          </button>
        ))}
        {floorTables.filter((table) => table.active && table.effectiveStatus === 'available').map((table) => (
          <button type="button" className="session-pick-card free" key={table.id} disabled={busy || undefined} onClick={() => openTable(table.id)}>
            <div className="session-pick-head"><b>{table.code}</b><span className="table-status-pill status-available">Free</span></div>
            <small>{table.areaName || 'Floor'} · {table.capacity || 0} seats</small>
            <span className="session-pick-open">{busy ? <Loader2 size={13} className="spin" /> : <>Open service</>}</span>
          </button>
        ))}
        {!floorTables.filter((t) => t.active).length && <div className="picker-empty">No tables configured. Ask a manager to set up the floor in Settings.</div>}
      </div>
    </section>}

    {mode === 'table' && session && <section className="panel session-bar">
      <div className="session-bar-main">
        <div className="session-bar-id"><LayoutGrid size={17} /><div><b>Table {session.tableCode}</b><small>{session.areaName || 'Floor'}{session.tableName ? ` · ${session.tableName}` : ''} · open {elapsed(session.openedAt)}</small></div></div>
        <div className="session-bar-stats">
          <span><b>{money(sessionBill)}</b><small>Bill</small></span>
          <span><b>{money(sessionPaid)}</b><small>Paid</small></span>
          <span className={sessionBalance > 0 ? 'due' : 'settled'}><b>{money(Math.max(0, sessionBalance))}</b><small>{sessionBalance > 0 ? 'Balance due' : 'Settled'}</small></span>
          <span><b>{session.orders.filter((order) => order.state === 'served').length}</b><small>Served rounds</small></span>
        </div>
      </div>
      <div className="session-bar-actions">
        {users.length > 0 && <label className="inline-select">Waiter<select value={session.waiterId || ''} onChange={(event) => assignWaiter(event.target.value)}><option value="">Unassigned</option>{users.map((employee) => <option key={employee.id} value={employee.id}>{employee.name} · {employee.role}</option>)}</select></label>}
        {canManage && <button type="button" className="button button-outline button-small" onClick={() => setTransferForm({ targetTableId: '', reason: '' })}>Move table</button>}
        <button type="button" className="button button-outline button-small" onClick={() => { releaseSession(); setMode('table'); }}><Armchair size={14} /> Switch table</button>
        <button type="button" className="button button-primary button-small" disabled={sessionBill <= 0 || busy} onClick={() => setCloseForm({ discount: '', customerId: '' })}>Close table · {money(sessionBill - (canDiscount ? cents(closeForm?.discount || 0) : 0))}</button>
      </div>
    </section>}

    <div className="pos-layout">
      <section className="panel product-picker">
        <div className="picker-head"><div><span className="section-label">PRODUCT CATALOGUE</span><h2>{mode === 'table' && session ? `New round · Table ${session.tableCode}` : 'Choose items'}</h2></div><span className="result-count">{shown.length} products</span></div>
        <div className="search-box pos-search"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={searchKeyDown} placeholder="Search by name or scan barcode" autoFocus aria-label="Search products by name or barcode" /></div>
        <div className="pos-scan-hint"><Barcode size={13} /> Press Enter to add an exact barcode match or a single result</div>
        {categories.length > 1 && <div className="pos-categories">
          <button type="button" className={`pos-category-chip ${!activeCategory ? 'active' : ''}`} onClick={() => setActiveCategory('')}>All drinks</button>
          {categories.map((category) => <button type="button" className={`pos-category-chip ${activeCategory === category ? 'active' : ''}`} key={category} onClick={() => setActiveCategory(activeCategory === category ? '' : category)}>{category}</button>)}
        </div>}
        <div className="picker-grid">{shown.map((product) => {
          const stock = Number(product.stockQuantity) || 0;
          return <article className="picker-card product-card" key={product.id}>
            <span className="picker-product-icon"><Beer size={17} /></span>
            <b>{product.name}</b>
            <small>{product.sku ? `SKU ${product.sku} · ` : ''}{product.stockQuantity} {product.baseUnit}s available</small>
            <div className="unit-choice-list">{product.units.map((unit) => { const added = cart.find((item) => item.product.id === product.id && item.unit.id === unit.id)?.qty || 0; const inStock = stock >= (added + 1) * Number(unit.factorToBase); return <button type="button" className="unit-choice" key={unit.id} disabled={!inStock} onClick={() => add(product, unit)}><span>Add {unit.unitName}</span><b>{money(unit.sellingPrice)}</b></button>; })}</div>
          </article>;
        })}{!shown.length && <div className="picker-empty">No products match this search.</div>}</div>
      </section>

      {mode === 'walkin' ? <form className="panel cart-panel" onSubmit={finish}>
        <div className="cart-heading"><div><span className="section-label">WALK-IN ORDER</span><h2>Your basket <span>{cart.reduce((sum, item) => sum + item.qty, 0)}</span></h2></div><ShoppingCart size={19} /></div>
        {cart.length ? <div className="cart-lines">{cart.map((item) => {
          const lineTotal = Math.round(Number(item.unit.sellingPrice) * 100) * item.qty;
          const atMax = item.qty >= maxQtyFor(item);
          return <div className="cart-line" key={item.key}>
            <div className="cart-line-icon"><Beer size={15} /></div>
            <div className="cart-line-copy"><b>{item.product.name} · {item.unit.unitName}</b><small>{money(item.unit.sellingPrice)} each</small></div>
            <div className="quantity-control">
              <button type="button" onClick={() => changeQty(item.key, -1)} aria-label="Decrease quantity"><Minus size={13} /></button>
              <input className="quantity-input" type="number" min="0" step="any" inputMode="decimal" value={qtyDrafts[item.key] ?? String(item.qty)} onChange={(event) => typeQty(item.key, event.target.value)} onBlur={() => commitQty(item.key)} aria-label={`Quantity of ${item.product.name}`} />
              <button type="button" disabled={atMax} onClick={() => changeQty(item.key, 1)} aria-label="Increase quantity"><Plus size={13} /></button>
            </div>
            <b className="cart-line-subtotal">{money(lineTotal / 100)}</b>
            <button type="button" className="remove-item" onClick={() => removeLine(item.key)} aria-label="Remove item"><Trash2 size={15} /></button>
          </div>;
        })}</div> : <div className="cart-empty"><div className="empty-icon"><ShoppingCart size={20} /></div><b>Your basket is empty</b><span>Select a product package to start an order.</span></div>}
        <div className="cart-checkout">
          <div className="pos-summary">
            <div><span>Subtotal</span><b>{money(subtotal / 100)}</b></div>
            {discount > 0 && <div className="pos-summary-discount"><span>Discount</span><b>−{money(discount / 100)}</b></div>}
            <div className="cart-total"><span>Total due</span><b>{money(total / 100)}</b></div>
          </div>
          {canDiscount ? <div className="pos-discount">
            <label>Discount (RWF)<input type="number" min="0" step="0.01" value={discountInput} onChange={(event) => setDiscountInput(event.target.value)} placeholder="0" disabled={!cart.length} aria-label="Discount amount" /></label>
            <div className="pos-discount-quick">
              <button type="button" onClick={() => applyDiscountPercent(5)} disabled={!subtotal}>5%</button>
              <button type="button" onClick={() => applyDiscountPercent(10)} disabled={!subtotal}>10%</button>
              <button type="button" onClick={() => setDiscountInput('')} disabled={!discountInput}>Clear</button>
            </div>
          </div> : <div className="pos-discount-locked"><BadgePercent size={14} /><span>Discounts need owner or manager approval.</span></div>}
          <label>Customer<select value={customerId} onChange={(event) => setCustomerId(event.target.value)}><option value="">Walk-in customer</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></label>
          <button type="button" className="text-link" onClick={() => setShowCustomer(true)}><UserRoundPlus size={14} /> Add customer</button>
          <div className="pos-payment-lines">{payments.map((line, index) => <div className="pos-payment-line" key={index}>
            <label>Amount applied<input type="number" min="0" step="0.01" value={line.autoFill ? defaultPayment : line.amount} onChange={(event) => setPayments((current) => current.map((item, i) => i === index ? { ...item, amount: event.target.value, autoFill: false } : item))} placeholder="Optional" /></label>
            <label>Method<select value={line.method} onChange={(event) => setPayments((current) => current.map((item, i) => i === index ? { ...item, method: event.target.value } : item))}><option value="cash">Cash</option><option value="mobile_money">Mobile Money</option><option value="bank_transfer">Bank transfer</option><option value="card">Card</option></select></label>
            <button type="button" className="icon-button" aria-label="Remove payment" onClick={() => setPayments((current) => current.filter((_, i) => i !== index))}><X size={14} /></button>
          </div>)}</div>
          {payments.length < 4 && <button type="button" className="text-link" onClick={() => setPayments((current) => [...current, { method: 'mobile_money', amount: '', autoFill: false }])}><Plus size={14} /> Add split payment</button>}
          <div className="payment-balance"><span>Still due</span><b>{money(Math.max(0, total - applied) / 100)}</b></div>
          <div className="pos-hold-row">
            <input className="hold-label-input" value={holdLabel} onChange={(event) => setHoldLabel(event.target.value)} placeholder="Label for held cart (optional)" aria-label="Held cart label" disabled={!cart.length} />
            <button type="button" className="button button-outline button-small" disabled={!cart.length || busy} onClick={holdCart}><Pause size={14} /> Hold</button>
            <button type="button" className="text-link" onClick={loadHeld}>Resume held</button>
          </div>
          <button className="button button-primary checkout-button" disabled={!cart.length || busy}>{busy ? 'Saving sale…' : `Complete sale · ${money(total / 100)}`}</button>
          <small className="checkout-note">Stock is reduced the moment the sale completes. Credit needs a customer.</small>
        </div>
      </form> : session && <form className="panel cart-panel" onSubmit={(event) => { event.preventDefault(); sendRound(true); }}>
        <div className="cart-heading"><div><span className="section-label">NEW ROUND</span><h2>Table {session.tableCode} <span>{cart.reduce((sum, item) => sum + item.qty, 0)}</span></h2></div><UtensilsCrossed size={19} /></div>
        {cart.length ? <div className="cart-lines">{cart.map((item) => {
          const lineTotal = Math.round(Number(item.unit.sellingPrice) * 100) * item.qty;
          const atMax = item.qty >= maxQtyFor(item);
          return <div className="cart-line" key={item.key}>
            <div className="cart-line-icon"><Beer size={15} /></div>
            <div className="cart-line-copy"><b>{item.product.name} · {item.unit.unitName}</b><small>{money(item.unit.sellingPrice)} each</small></div>
            <div className="quantity-control">
              <button type="button" onClick={() => changeQty(item.key, -1)} aria-label="Decrease quantity"><Minus size={13} /></button>
              <input className="quantity-input" type="number" min="0" step="any" inputMode="decimal" value={qtyDrafts[item.key] ?? String(item.qty)} onChange={(event) => typeQty(item.key, event.target.value)} onBlur={() => commitQty(item.key)} aria-label={`Quantity of ${item.product.name}`} />
              <button type="button" disabled={atMax} onClick={() => changeQty(item.key, 1)} aria-label="Increase quantity"><Plus size={13} /></button>
            </div>
            <b className="cart-line-subtotal">{money(lineTotal / 100)}</b>
            <button type="button" className="remove-item" onClick={() => removeLine(item.key)} aria-label="Remove item"><Trash2 size={15} /></button>
          </div>;
        })}</div> : <div className="cart-empty"><div className="empty-icon"><UtensilsCrossed size={20} /></div><b>No items in this round</b><span>Serving deducts stock once — payment can come later.</span></div>}
        <div className="cart-checkout">
          <div className="pos-summary"><div className="cart-total"><span>This round</span><b>{money(subtotal / 100)}</b></div></div>
          <button className="button button-primary checkout-button" disabled={!cart.length || busy} type="submit">{busy ? <Loader2 size={14} className="spin" /> : <>Serve round now · {money(subtotal / 100)}</>}</button>
          <button type="button" className="button button-outline" disabled={!cart.length || busy} onClick={() => sendRound(false)}><Pause size={14} /> Save as draft</button>
          <small className="checkout-note">Drafts keep stock untouched. Serving deducts stock exactly once, even if payment happens later.</small>
        </div>

        <div className="session-bill">
          <div className="session-bill-head"><span className="section-label">TABLE BILL</span><h2>Running bill</h2></div>
          {session.orders.map((order) => <div className={`round-card state-${order.state}`} key={order.id}>
            <div className="round-head">
              <b>Round {order.roundNo}</b>
              <span className={`round-state state-${order.state}`}>{order.state === 'served' ? 'Served' : order.state === 'draft' ? 'Draft' : 'Voided'}</span>
              <small>{order.reference}{order.state === 'served' && order.servedAt ? ` · ${new Date(order.servedAt).toLocaleTimeString()}` : ''}</small>
              {order.state !== 'voided' && <div className="round-actions">
                {order.state === 'draft' && <button type="button" className="button button-small button-primary" disabled={busy} onClick={() => serveDraft(order)}><Play size={13} /> Serve</button>}
                {(order.state === 'draft' || canManage) && <button type="button" className="button button-small button-outline" disabled={busy} onClick={() => setVoidTarget({ ...order, reason: '' })}>Void</button>}
              </div>}
            </div>
            {order.items.map((item) => <div className="round-item" key={item.id}>
              <span><b>{Number(item.quantity)}</b> × {item.productName} <small>({item.unitName})</small></span>
              <b>{money(item.lineTotal)}</b>
            </div>)}
            {order.state !== 'voided' && <div className="round-total"><span>Round total</span><b>{money(order.items.reduce((sum, item) => sum + Number(item.lineTotal), 0))}</b></div>}
          </div>)}
          {!session.orders.length && <div className="session-bill-empty"><UtensilsCrossed size={18} /><b>No rounds yet</b><span>Add drinks above, then serve the round.</span></div>}
          {session.payments.length > 0 && <div className="session-payments">
            <span className="section-label">PAYMENTS</span>
            {session.payments.map((payment) => <div className="session-payment" key={payment.id}>
              <span><Banknote size={13} /> {payment.method.replace('_', ' ')}<small> · {payment.receivedByName || ''}</small></span><b>{money(payment.amount)}</b>
            </div>)}
          </div>}
          <div className="session-bill-summary">
            <div><span>Bill</span><b>{money(sessionBill)}</b></div>
            <div><span>Paid</span><b>{money(sessionPaid)}</b></div>
            <div className="cart-total"><span>{sessionBalance > 0 ? 'Balance due' : 'Settled'}</span><b>{money(Math.max(0, sessionBalance))}</b></div>
          </div>
          <div className="session-bill-actions">
            <button type="button" className="button button-outline" disabled={sessionBalance <= 0 || busy} onClick={() => setPayForm({ method: 'cash', amount: String(sessionBalance) })}><Banknote size={15} /> Take payment</button>
          </div>
        </div>
      </form>}
    </div>

    {receipt && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setReceipt(null)}>
      <div className="modal receipt-modal pos-receipt-modal">
        <div className="modal-title no-print"><div><span className="section-label">SALE COMPLETE</span><h2>{receipt.reference}</h2></div><button className="icon-button" onClick={() => setReceipt(null)} aria-label="Close"><X size={18} /></button></div>
        <ReceiptCard sale={receipt} businessName={businessName} />
        <div className="modal-actions no-print">
          <button className="button button-quiet" type="button" onClick={() => setReceipt(null)}>{mode === 'table' ? 'Back to POS' : 'New sale'}</button>
          <button className="button button-outline" type="button" onClick={() => downloadReceipt(receipt, businessName)}><Download size={15} /> Download receipt</button>
          <button className="button button-primary" type="button" onClick={() => window.print()}><Printer size={15} /> Print receipt</button>
        </div>
      </div>
    </div>}

    {payForm && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setPayForm(null)}>
      <form className="modal" onSubmit={takePayment}>
        <div className="modal-title"><div><span className="section-label">TABLE BILL</span><h2>Take payment · Table {session?.tableCode}</h2></div><button type="button" className="icon-button" onClick={() => setPayForm(null)} aria-label="Close"><X size={18} /></button></div>
        <label>Amount (up to {money(sessionBalance)})<input required type="number" min="0" step="0.01" max={sessionBalance} value={payForm.amount} onChange={(event) => setPayForm({ ...payForm, amount: event.target.value })} /></label>
        <label>Method<select value={payForm.method} onChange={(event) => setPayForm({ ...payForm, method: event.target.value })}><option value="cash">Cash</option><option value="mobile_money">Mobile Money</option><option value="bank_transfer">Bank transfer</option><option value="card">Card</option></select></label>
        <small className="modal-note">Cash needs an open cash session. Split bills by taking several payments.</small>
        <div className="modal-actions"><button type="button" className="button button-quiet" onClick={() => setPayForm(null)}>Cancel</button><button className="button button-primary" disabled={busy}>{busy ? <Loader2 size={14} className="spin" /> : 'Record payment'}</button></div>
      </form>
    </div>}

    {closeForm && session && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setCloseForm(null)}>
      <form className="modal" onSubmit={closeTable}>
        <div className="modal-title"><div><span className="section-label">CLOSE TABLE</span><h2>Table {session.tableCode}</h2></div><button type="button" className="icon-button" onClick={() => setCloseForm(null)} aria-label="Close"><X size={18} /></button></div>
        <div className="close-summary">
          <div><span>Bill</span><b>{money(sessionBill)}</b></div>
          <div><span>Paid</span><b>{money(sessionPaid)}</b></div>
          <div><span>Balance</span><b>{money(sessionBalance)}</b></div>
        </div>
        {canDiscount && <label>Bill discount (RWF)<input type="number" min="0" step="0.01" max={sessionBill} value={closeForm.discount} onChange={(event) => setCloseForm({ ...closeForm, discount: event.target.value })} placeholder="0" /></label>}
        {sessionBalance > 0 && <label>Credit customer (required for unpaid balance)<select value={closeForm.customerId} onChange={(event) => setCloseForm({ ...closeForm, customerId: event.target.value })} required={sessionBalance > 0}><option value="">Choose customer…</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></label>}
        {sessionBalance > 0 && !canManage && <div className="notice notice-error">An unpaid balance needs a manager to transfer it to customer credit. Settle the bill first.</div>}
        <small className="modal-note">Closing creates the table sale receipt, frees the table and records exactly what was served.</small>
        <div className="modal-actions"><button type="button" className="button button-quiet" onClick={() => setCloseForm(null)}>Keep table open</button><button className="button button-primary" disabled={busy || (sessionBalance > 0 && !closeForm.customerId)}>{busy ? <Loader2 size={14} className="spin" /> : 'Close table'}</button></div>
      </form>
    </div>}

    {voidTarget && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setVoidTarget(null)}>
      <form className="modal" onSubmit={voidRound}>
        <div className="modal-title"><div><span className="section-label">VOID ROUND</span><h2>Round {voidTarget.roundNo}</h2></div><button type="button" className="icon-button" onClick={() => setVoidTarget(null)} aria-label="Close"><X size={18} /></button></div>
        <p className="modal-copy">{voidTarget.state === 'served' ? 'Voiding a served round restores its stock and removes it from the bill. This is audited.' : 'Voiding a draft simply discards the unserved items.'}</p>
        <label>Reason<input required maxLength="500" value={voidTarget.reason} onChange={(event) => setVoidTarget({ ...voidTarget, reason: event.target.value })} placeholder="Wrong round, customer changed order…" /></label>
        <div className="modal-actions"><button type="button" className="button button-quiet" onClick={() => setVoidTarget(null)}>Cancel</button><button className="button button-primary" disabled={busy || !voidTarget.reason}>{busy ? <Loader2 size={14} className="spin" /> : 'Void round'}</button></div>
      </form>
    </div>}

    {transferForm && session && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setTransferForm(null)}>
      <form className="modal" onSubmit={transferTable}>
        <div className="modal-title"><div><span className="section-label">MOVE TABLE</span><h2>Table {session.tableCode} moves to…</h2></div><button type="button" className="icon-button" onClick={() => setTransferForm(null)} aria-label="Close"><X size={18} /></button></div>
        <label>Target table<select required value={transferForm.targetTableId} onChange={(event) => setTransferForm({ ...transferForm, targetTableId: event.target.value })}><option value="">Choose a free table…</option>{floorTables.filter((table) => table.active && table.effectiveStatus === 'available').map((table) => <option key={table.id} value={table.id}>{table.code} · {table.areaName || 'Floor'}</option>)}</select></label>
        <label>Reason<input required maxLength="500" value={transferForm.reason} onChange={(event) => setTransferForm({ ...transferForm, reason: event.target.value })} placeholder="Customer moved to the terrace…" /></label>
        <div className="modal-actions"><button type="button" className="button button-quiet" onClick={() => setTransferForm(null)}>Cancel</button><button className="button button-primary" disabled={busy || !transferForm.targetTableId}>{busy ? <Loader2 size={14} className="spin" /> : 'Move table'}</button></div>
      </form>
    </div>}

    {showHeld && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setShowHeld(false)}>
      <div className="modal">
        <div className="modal-title"><div><span className="section-label">HELD CARTS</span><h2>Resume a held order</h2></div><button type="button" className="icon-button" onClick={() => setShowHeld(false)} aria-label="Close"><X size={18} /></button></div>
        {held.length ? <div className="held-list">{held.map((item) => <div className="held-item" key={item.id}>
          <div className="held-copy"><b>{item.label}</b><small>{item.heldByName} · {new Date(item.createdAt).toLocaleString()} · {item.items.length} lines</small>
            <div className="held-lines">{item.items.map((line) => <span key={line.id}>{Number(line.quantity)} × {line.productName} ({line.unitName})</span>)}</div>
          </div>
          <div className="held-actions"><button className="button button-small button-primary" disabled={busy} onClick={() => resumeHeld(item)}><Play size={13} /> Resume</button><button className="button button-small button-outline" onClick={() => discardHeld(item)}><Trash2 size={13} /> Discard</button></div>
        </div>)}</div> : <div className="settings-empty"><Pause size={19} /><b>No held carts</b><span>Hold a walk-in cart to park it for later.</span></div>}
      </div>
    </div>}

    {showCustomer && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setShowCustomer(false)}><form className="modal" onSubmit={saveCustomer}><div className="modal-title"><div><span className="section-label">CUSTOMER BOOK</span><h2>Add customer</h2></div><button type="button" className="icon-button" onClick={() => setShowCustomer(false)} aria-label="Close"><X size={18} /></button></div><label>Full name<input required maxLength="160" value={customerForm.name} onChange={(event) => setCustomerForm({ ...customerForm, name: event.target.value })} /></label><label>Phone (optional)<input maxLength="40" value={customerForm.phone} onChange={(event) => setCustomerForm({ ...customerForm, phone: event.target.value })} /></label><div className="modal-actions"><button type="button" className="button button-quiet" onClick={() => setShowCustomer(false)}>Cancel</button><button className="button button-primary">Save customer</button></div></form></div>}
  </div>;
}
