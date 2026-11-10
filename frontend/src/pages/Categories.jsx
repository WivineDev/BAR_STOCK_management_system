import { useEffect, useState } from 'react';
import { Archive, FolderTree, Plus, RotateCcw } from 'lucide-react';
import api from '../services/api.js';

export default function Categories() {
  const [items, setItems] = useState([]); const [name, setName] = useState(''); const [editing, setEditing] = useState(null);
  const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [busy, setBusy] = useState(false);
  async function load() {
    try { const { data } = await api.get('/categories', { params: { includeArchived: true } }); setItems(data.items); setError(''); }
    catch (err) { setError(err.response?.data?.error || 'Categories could not be loaded.'); }
  }
  useEffect(() => { load(); }, []);
  function startEdit(category) { setEditing(category); setName(category.name); }
  function resetForm() { setEditing(null); setName(''); }
  async function save(event) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      if (editing) await api.patch(`/categories/${editing.id}`, { name, archived: Boolean(editing.archivedAt) });
      else await api.post('/categories', { name });
      setNotice(editing ? 'Category updated.' : 'Category created.'); resetForm(); await load();
    } catch (err) { setError(err.response?.data?.error || 'Category could not be saved.'); }
    finally { setBusy(false); }
  }
  async function setArchived(category, archived) {
    setError(''); setNotice('');
    try { await api.patch(`/categories/${category.id}`, { name: category.name, archived }); setNotice(archived ? 'Category archived.' : 'Category restored.'); await load(); }
    catch (err) { setError(err.response?.data?.error || 'Category could not be updated.'); }
  }
  return <div className="content-page">
    <div className="page-heading"><div><div className="date-label">PRODUCT ORGANIZATION</div><h1>Categories</h1><p>Group products for quicker browsing and clearer sales reports.</p></div></div>
    {error && <div className="notice notice-error">{error}</div>}{notice && <div className="notice notice-success">{notice}</div>}
    <div className="category-layout"><form className="panel category-form" onSubmit={save}><div className="panel-heading"><div><span className="section-label">CATEGORY SETUP</span><h2>{editing ? 'Edit category' : 'Add category'}</h2></div><FolderTree size={18} /></div><label>Category name<input required maxLength="100" value={name} onChange={(event) => setName(event.target.value)} placeholder="Beer, wine, soft drinks" /></label><div className="modal-actions"><button className="button button-primary" disabled={busy || !name.trim()}>{busy ? 'Saving…' : editing ? 'Save changes' : <><Plus size={15} /> Add category</>}</button>{editing && <button className="button button-quiet" type="button" onClick={resetForm}>Cancel</button>}</div></form>
      <div className="panel table-panel"><div className="panel-heading padded-heading"><div><span className="section-label">PRODUCT GROUPS</span><h2>Categories</h2></div><span className="result-count">{items.filter((item) => !item.archivedAt).length} active</span></div><div className="table-scroll"><table><thead><tr><th>NAME</th><th>STATUS</th><th>CREATED</th><th></th></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td><b>{item.name}</b></td><td>{item.archivedAt ? 'Archived' : 'Active'}</td><td>{new Date(item.createdAt).toLocaleDateString()}</td><td><div className="category-actions"><button className="button button-small button-outline" onClick={() => startEdit(item)}>Edit</button><button className="button button-small button-quiet" onClick={() => setArchived(item, !item.archivedAt)}>{item.archivedAt ? <><RotateCcw size={13} /> Restore</> : <><Archive size={13} /> Archive</>}</button></div></td></tr>)}</tbody></table>{!items.length && <div className="table-empty"><div className="empty-icon"><FolderTree size={18} /></div><b>No categories yet</b><span>Create categories to organize the product catalogue.</span></div>}</div></div></div>
  </div>;
}
