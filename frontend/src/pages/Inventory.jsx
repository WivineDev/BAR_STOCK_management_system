import { useEffect, useState } from 'react';
import { Boxes, Plus, Search, X } from 'lucide-react';
import api from '../services/api.js';
import { productImage } from '../utils/productImage.js';
import TablePagination from '../components/TablePagination.jsx';

const currency = (n) => new Intl.NumberFormat('en-RW', { style: 'currency', currency: 'RWF', maximumFractionDigits: 0 }).format(Number(n || 0));

export default function Inventory() {
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [meta, setMeta] = useState({ page: 1, limit: 10, totalRecords: 0, totalPages: 0 });
  const [target, setTarget] = useState(null);
  const [form, setForm] = useState({ quantity: '', notes: '' });
  const [error, setError] = useState('');

  async function load() {
    try {
      const { data } = await api.get('/products', { params: { search, page, limit } });
      setItems(data.items);
      setMeta(data.meta);
      setPage(data.meta.page);
      setError('');
    } catch {
      setError('Inventory could not be loaded.');
    }
  }

  useEffect(() => { load(); }, [search, page, limit]);

  async function adjust(event) {
    event.preventDefault();
    try {
      await api.post(`/inventory/${target.id}/adjustments`, form);
      setTarget(null);
      setForm({ quantity: '', notes: '' });
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Stock adjustment failed.');
    }
  }

  return <div className="content-page">
    <div className="page-heading"><div><div className="date-label">STOCK CONTROL</div><h1>Inventory</h1><p>Track on-hand quantities and record each stock adjustment.</p></div></div>
    {error && <div className="notice notice-error">{error}</div>}
    <div className="table-toolbar"><div className="search-box"><Search size={17} /><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Search product or SKU" /></div><span className="result-count">Quantities shown in base units</span></div>
    <div className="panel table-panel"><div className="table-scroll"><table><thead><tr><th>#</th><th>PRODUCT</th><th>ON HAND</th><th>LOW STOCK AT</th><th>STOCK VALUE</th><th>LEVEL</th><th></th></tr></thead><tbody>{items.map((product, index) => {
      const low = Number(product.stockQuantity) <= Number(product.lowStockThreshold);
      return <tr key={product.id}><td>{(page - 1) * limit + index + 1}</td><td><div className="product-cell"><div className="product-icon">{productImage(product) ? <img src={productImage(product)} alt="" loading="lazy" /> : <Boxes size={17} />}</div><div><b>{product.name}</b><small>{product.sku || 'No SKU'} · per {product.baseUnit}</small></div></div></td><td><b>{product.stockQuantity} {product.baseUnit}s</b></td><td>{product.lowStockThreshold} {product.baseUnit}s</td><td className="table-money">{currency(Number(product.stockQuantity) * Number(product.costPrice))}</td><td><span className={`status-chip ${low ? 'status-low' : 'status-good'}`}>{Number(product.stockQuantity) === 0 ? 'Out of stock' : low ? 'Low stock' : 'Healthy'}</span></td><td><button className="button button-small button-outline" onClick={() => setTarget(product)}><Plus size={14} /> Adjust</button></td></tr>;
    })}</tbody></table>{!items.length && <div className="table-empty"><div className="empty-icon"><Boxes size={19} /></div><b>No stock records</b><span>Add a product, then receive opening stock here.</span></div>}</div><TablePagination page={page} meta={meta} limit={limit} onPageChange={setPage} onLimitChange={(value) => { setLimit(value); setPage(1); }} /></div>
    {target && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setTarget(null)}><form className="modal" onSubmit={adjust}><div className="modal-title"><div><span className="section-label">STOCK MOVEMENT</span><h2>Adjust {target.name}</h2></div><button type="button" className="icon-button" onClick={() => setTarget(null)}><X size={18} /></button></div><p className="field-hint">Current stock: <b>{target.stockQuantity} {target.baseUnit}s</b>. Enter a positive number to add stock or a negative number to remove stock. The server rejects changes that would make stock negative.</p><label>Quantity change ({target.baseUnit}s)<input type="number" step="1" required value={form.quantity} onChange={(event) => setForm({ ...form, quantity: event.target.value })} placeholder="e.g. 24 or -2" /></label><label>Reason<textarea required maxLength="500" value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="Opening count, damaged stock, correction…" /></label><div className="modal-actions"><button type="button" className="button button-quiet" onClick={() => setTarget(null)}>Cancel</button><button className="button button-primary">Save movement</button></div></form></div>}
  </div>;
}
