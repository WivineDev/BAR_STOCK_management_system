import { useEffect, useState } from 'react';
import { Box, Package, Pencil, Plus, Search, X } from 'lucide-react';
import api from '../services/api.js';
import { useAuth } from '../state/AuthContext.jsx';
import { productImage, PRODUCT_IMAGE_CHOICES } from '../utils/productImage.js';
import TablePagination from '../components/TablePagination.jsx';

const currency = (n) => new Intl.NumberFormat('en-RW', { style: 'currency', currency: 'RWF', maximumFractionDigits: 0 }).format(Number(n || 0));
const emptyProduct = () => ({ name: '', sku: '', imageKey: '', categoryId: '', baseUnit: 'bottle', lowStockThreshold: '0' });
const emptyUnit = () => ({ unitName: '', factorToBase: '', sellingPrice: '', purchasePrice: '' });
const canManage = (user) => ['owner', 'manager'].includes(user?.role);

export default function Products() {
  const { user } = useAuth();
  const [items, setItems] = useState([]); const [categories, setCategories] = useState([]); const [search, setSearch] = useState(''); const [page, setPage] = useState(1); const [limit, setLimit] = useState(10); const [meta, setMeta] = useState({ page: 1, limit: 10, totalRecords: 0, totalPages: 0 }); const [show, setShow] = useState(false); const [error, setError] = useState('');
  const [form, setForm] = useState(emptyProduct()); const [editingProduct, setEditingProduct] = useState(null); const [unitTarget, setUnitTarget] = useState(null); const [units, setUnits] = useState([]); const [unitForm, setUnitForm] = useState(emptyUnit());
  async function load(nextPage = page, nextSearch = search) { try { const { data } = await api.get('/products', { params: { search: nextSearch, page: nextPage, limit, sortBy: 'createdAt', sortOrder: 'desc' } }); setItems(data.items); setMeta(data.meta || { page: nextPage, limit, totalRecords: 0, totalPages: 0 }); setError(''); } catch { setError('Products could not be loaded.'); } }
  useEffect(() => { load(page); }, [search, page, limit]);
  useEffect(() => { api.get('/categories').then(({ data }) => setCategories(data.items)).catch(() => { }); }, []);
  function closeProductForm() { setShow(false); setEditingProduct(null); setForm(emptyProduct()); }
  function editProduct(product) {
    setEditingProduct(product);
    setForm({ name: product.name, sku: product.sku || '', imageKey: product.imagePath || '', categoryId: product.categoryId || '', baseUnit: product.baseUnit, lowStockThreshold: String(product.lowStockThreshold) });
    if (product.categoryId && !categories.some((category) => category.id === product.categoryId)) setCategories((current) => [...current, { id: product.categoryId, name: `${product.categoryName} (archived)` }]);
    setShow(true);
  }
  async function save(event) {
    event.preventDefault();
    try {
      const payload = { ...form, categoryId: form.categoryId || null };
      if (editingProduct) {
        await api.patch(`/products/${editingProduct.id}`, payload);
        closeProductForm(); await load();
        return;
      }
      await api.post('/products', payload);
      closeProductForm(); setSearch(''); setPage(1); await load(1, '');
    } catch (err) { setError(err.response?.data?.error || 'Product could not be saved.'); }
  }
  async function openUnits(product) {
    setUnitTarget(product); setUnitForm(emptyUnit());
    try { const { data } = await api.get(`/products/${product.id}/units`); setUnits(data.items); }
    catch (err) { setError(err.response?.data?.error || 'Packaging units could not be loaded.'); }
  }
  async function saveUnit(event) {
    event.preventDefault();
    try { await api.post(`/products/${unitTarget.id}/units`, unitForm); const { data } = await api.get(`/products/${unitTarget.id}/units`); setUnits(data.items); setUnitForm(emptyUnit()); }
    catch (err) { setError(err.response?.data?.error || 'Packaging unit could not be saved.'); }
  }
  return <div className="content-page products-page" style={{ '--page-offset': (page - 1) * limit }}>
    <div className="page-heading"><div><div className="date-label">CATALOGUE</div><h1>Products</h1><p>Keep your drinks, categories, prices, and stock thresholds in order.</p></div>{canManage(user) && <button className="button button-primary" onClick={() => { setEditingProduct(null); setForm(emptyProduct()); setShow(true); }}><Plus size={17} /> Add product</button>}</div>
    {error && <div className="notice notice-error">{error}</div>}
    <div className="table-toolbar"><div className="search-box"><Search size={17} /><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Search name or SKU" /></div><span className="result-count">{meta.totalRecords} products</span><label>Rows<select aria-label="Products per page" value={limit} onChange={(event) => { setLimit(Number(event.target.value)); setPage(1); }}><option value={5}>5</option><option value={10}>10</option><option value={25}>25</option><option value={50}>50</option></select></label></div>
    <div className="panel table-panel"><div className="table-scroll"><table><thead><tr><th>#</th><th>PRODUCT</th><th>CATEGORY</th><th>SKU</th><th>IN STOCK</th><th>STATUS</th><th>MANAGE</th></tr></thead><tbody>{items.map((product, index) => <tr key={product.id}><td>{(page - 1) * limit + index + 1}</td><td><div className="product-cell"><div className="product-icon">{productImage(product) ? <img src={productImage(product)} alt="" loading="lazy" /> : <Package size={17} />}</div><div><b>{product.name}</b><small>Per {product.baseUnit}</small></div></div></td><td>{product.categoryName || 'Uncategorized'}</td><td>{product.sku || '—'}</td><td>{product.stockQuantity} {product.baseUnit}s</td><td><span className={`status-chip ${Number(product.stockQuantity) <= Number(product.lowStockThreshold) ? 'status-low' : 'status-good'}`}>{Number(product.stockQuantity) <= Number(product.lowStockThreshold) ? 'Low stock' : 'In stock'}</span></td><td><div className="category-actions">{canManage(user) && <><button className="button button-small button-outline" onClick={() => editProduct(product)}><Pencil size={13} /> Edit</button><button className="button button-small button-outline" onClick={() => openUnits(product)}><Box size={14} /> Units</button></>}</div></td></tr>)}</tbody></table>{!items.length && <div className="table-empty"><div className="empty-icon"><Package size={19} /></div><b>No products yet</b><span>Add your first product to get the stock list started.</span>{canManage(user) && <button className="text-link" onClick={() => setShow(true)}>Add a product <Plus size={14} /></button>}</div>}</div><TablePagination page={page} meta={meta} onPageChange={setPage} /></div>
    {show && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && closeProductForm()}><form className="modal" onSubmit={save}>
      <div className="modal-title"><div><span className="section-label">PRODUCT CATALOGUE</span><h2>{editingProduct ? 'Edit product' : 'Add product'}</h2></div><button className="icon-button" type="button" onClick={closeProductForm} aria-label="Close"><X size={18} /></button></div>
      <label>Product name<input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="e.g. Primus" /></label>
      <div className="form-two"><label>Category<select value={form.categoryId} onChange={(event) => setForm({ ...form, categoryId: event.target.value })}><option value="">Uncategorized</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label><label>SKU<input value={form.sku} onChange={(event) => setForm({ ...form, sku: event.target.value })} placeholder="Optional code" /></label></div>
      <div className="image-field">
        <span className="section-label">PRODUCT IMAGE</span>
        <div className="image-choice-grid" role="radiogroup" aria-label="Product image">
          <button type="button" className={`image-choice ${form.imageKey === '' ? 'selected' : ''}`} role="radio" aria-checked={form.imageKey === ''} onClick={() => setForm({ ...form, imageKey: '' })}><span className="image-choice-none"><Package size={16} /></span><span>Auto</span></button>
          {PRODUCT_IMAGE_CHOICES.map(({ key, label }) => <button type="button" className={`image-choice ${form.imageKey === key ? 'selected' : ''}`} role="radio" aria-checked={form.imageKey === key} key={key} onClick={() => setForm({ ...form, imageKey: key })}><img src={`/images/products/${key}`} alt="" loading="lazy" decoding="async" /><span>{label}</span></button>)}
        </div>
        <p className="field-hint">Shown on the point of sale, the cart, and this catalogue. Auto uses the product's category image.</p>
      </div>
      <div className="form-two"><label>Base stock unit<input required readOnly={Boolean(editingProduct)} value={form.baseUnit} onChange={(event) => setForm({ ...form, baseUnit: event.target.value })} placeholder="bottle" /></label><label>Low stock threshold<input type="number" min="0" step="0.001" value={form.lowStockThreshold} onChange={(event) => setForm({ ...form, lowStockThreshold: event.target.value })} /></label></div>
      <p className="field-hint">Stock is recorded in the base unit. Selling price and weighted-average cost are managed when stock is received in the purchase workflow.</p><div className="modal-actions"><button type="button" className="button button-quiet" onClick={closeProductForm}>Cancel</button><button className="button button-primary">{editingProduct ? 'Save changes' : 'Save product'}</button></div>
    </form></div>}
    {unitTarget && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setUnitTarget(null)}><div className="modal">
      <div className="modal-title"><div><span className="section-label">PACKAGING CONFIGURATION</span><h2>{unitTarget.name} units</h2></div><button className="icon-button" type="button" onClick={() => setUnitTarget(null)} aria-label="Close"><X size={18} /></button></div>
      <div className="unit-list">{units.map((unit) => <div className="unit-row" key={unit.id}><div><b>{unit.unitName}</b><small>{unit.factorToBase} {unitTarget.baseUnit}s per unit {Number(unit.isBase) ? '· base unit' : ''}</small></div><span>{currency(unit.sellingPrice)} sell</span></div>)}</div>
      <form className="unit-form" onSubmit={saveUnit}><span className="section-label">ADD PACKAGING</span><div className="form-two"><label>Unit name<input required maxLength="40" value={unitForm.unitName} onChange={(event) => setUnitForm({ ...unitForm, unitName: event.target.value })} placeholder="Crate" /></label><label>Base units per package<input type="number" min="0.001" step="0.001" required value={unitForm.factorToBase} onChange={(event) => setUnitForm({ ...unitForm, factorToBase: event.target.value })} placeholder="20" /></label></div><div className="form-two"><label>Selling price (RWF)<input type="number" min="0" step="0.01" required value={unitForm.sellingPrice} onChange={(event) => setUnitForm({ ...unitForm, sellingPrice: event.target.value })} /></label><label>Purchase price (RWF)<input type="number" min="0" step="0.01" required value={unitForm.purchasePrice} onChange={(event) => setUnitForm({ ...unitForm, purchasePrice: event.target.value })} /></label></div><div className="modal-actions"><button className="button button-primary"><Plus size={14} /> Save packaging unit</button></div></form>
    </div></div>}
  </div>;
}
