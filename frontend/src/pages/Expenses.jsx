import { useEffect, useState } from 'react';
import { Plus, Receipt, X } from 'lucide-react';
import api from '../services/api.js';
import TablePagination from '../components/TablePagination.jsx';

const money = (n) => new Intl.NumberFormat('en-RW', { style: 'currency', currency: 'RWF', maximumFractionDigits: 0 }).format(Number(n || 0));

export default function Expenses() {
  const [items, setItems] = useState([]);
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ category: 'Operations', description: '', amount: '', paymentMethod: 'cash' });
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [meta, setMeta] = useState({ page: 1, limit: 10, totalRecords: 0, totalPages: 0 });

  async function load() {
    try {
      const { data } = await api.get('/expenses', { params: { page, limit } });
      setItems(data.items);
      setMeta(data.meta);
      setPage(data.meta.page);
      setError('');
    } catch {
      setError('Expenses could not be loaded.');
    }
  }

  useEffect(() => { load(); }, [page, limit]);

  async function save(event) {
    event.preventDefault();
    try {
      await api.post('/expenses', form);
      setShow(false);
      setForm({ category: 'Operations', description: '', amount: '', paymentMethod: 'cash' });
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Expense could not be saved.');
    }
  }

  return <div className="content-page">
    <div className="page-heading"><div><div className="date-label">BUSINESS COSTS</div><h1>Expenses</h1><p>Capture operating costs so your daily cash position stays grounded.</p></div><button className="button button-primary" onClick={() => setShow(true)}><Plus size={17} /> Record expense</button></div>
    {error && <div className="notice notice-error">{error}</div>}
    <div className="panel table-panel"><div className="panel-heading padded-heading"><div><span className="section-label">RECENT RECORDS</span><h2>Expense history</h2></div><span className="result-count">{meta.totalRecords} records</span></div><div className="table-scroll"><table><thead><tr><th>#</th><th>DATE</th><th>CATEGORY</th><th>DESCRIPTION</th><th>PAYMENT</th><th>AMOUNT</th></tr></thead><tbody>{items.map((item, index) => <tr key={item.id}><td>{(page - 1) * limit + index + 1}</td><td>{new Date(item.createdAt).toLocaleDateString()}</td><td><span className="category-pill"><Receipt size={13} />{item.category}</span></td><td>{item.description}</td><td className="capitalize">{item.paymentMethod.replace('_', ' ')}</td><td className="table-money">{money(item.amount)}</td></tr>)}</tbody></table>{!items.length && <div className="table-empty"><div className="empty-icon"><Receipt size={19} /></div><b>No expenses recorded</b><span>Add expenses as they occur to keep reports accurate.</span><button className="text-link" onClick={() => setShow(true)}>Record an expense <Plus size={14} /></button></div>}</div><TablePagination page={page} meta={meta} limit={limit} onPageChange={setPage} onLimitChange={(value) => { setLimit(value); setPage(1); }} /></div>
    {show && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setShow(false)}><form className="modal" onSubmit={save}><div className="modal-title"><div><span className="section-label">CASH OUT</span><h2>Record an expense</h2></div><button type="button" className="icon-button" onClick={() => setShow(false)}><X size={18} /></button></div><label>Category<input required value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} placeholder="Rent, transport, electricity…" /></label><label>Description<input required maxLength="250" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="What was the expense for?" /></label><label>Amount (RWF)<input type="number" min="1" step="1" required value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} /></label><label>Paid with<select value={form.paymentMethod} onChange={(event) => setForm({ ...form, paymentMethod: event.target.value })}><option value="cash">Cash</option><option value="mobile_money">Mobile Money</option><option value="bank_transfer">Bank transfer</option><option value="card">Card</option></select></label><div className="modal-actions"><button type="button" className="button button-quiet" onClick={() => setShow(false)}>Cancel</button><button className="button button-primary">Save expense</button></div></form></div>}
  </div>;
}
