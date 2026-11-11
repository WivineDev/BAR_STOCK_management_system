import { useEffect, useState } from 'react';
import { Armchair, Check, Layers, LoaderCircle, Package, PencilLine, Plus, Search, Settings as SettingsIcon, Trash2, X } from 'lucide-react';
import api from '../services/api.js';
import { useAuth } from '../state/AuthContext.jsx';
import TablePagination from '../components/TablePagination.jsx';

const money = (n) => new Intl.NumberFormat('en-RW', { style: 'currency', currency: 'RWF', maximumFractionDigits: 0 }).format(Number(n || 0));
const TABLE_STATUS_OPTIONS = [['available', 'Available'], ['reserved', 'Reserved'], ['out_of_service', 'Out of service']];
function pageRows(items, page, limit) {
  const totalPages = Math.ceil(items.length / limit);
  const currentPage = totalPages ? Math.min(page, totalPages) : 1;
  return {
    items: items.slice((currentPage - 1) * limit, currentPage * limit),
    meta: { page: currentPage, limit, totalRecords: items.length, totalPages },
  };
}

export default function Settings() {
  const { user } = useAuth();
  const [tab, setTab] = useState('floor');
  return <div className="content-page settings-page">
    <div className="page-heading"><div><div className="date-label">CONFIGURATION</div><h1>Settings</h1><p>Floor seating and product-specific unit conversions. Changes are audited with your name and time.</p></div></div>
    <div className="settings-tabs">
      <button type="button" className={`settings-tab ${tab === 'floor' ? 'active' : ''}`} onClick={() => setTab('floor')}><Armchair size={15} /> Floor &amp; seating</button>
      <button type="button" className={`settings-tab ${tab === 'units' ? 'active' : ''}`} onClick={() => setTab('units')}><Layers size={15} /> Product units &amp; conversions</button>
    </div>
    {tab === 'floor' ? <FloorSettings /> : <UnitsSettings user={user} />}
  </div>;
}

function FloorSettings() {
  const [areas, setAreas] = useState([]);
  const [tables, setTables] = useState([]);
  const [areaPage, setAreaPage] = useState(1); const [tablePage, setTablePage] = useState(1); const [listLimit, setListLimit] = useState(10);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [areaForm, setAreaForm] = useState(null);
  const [tableForm, setTableForm] = useState(null);
  const areaRows = pageRows(areas, areaPage, listLimit);
  const tableRows = pageRows(tables, tablePage, listLimit);

  async function load() {
    try { const { data } = await api.get('/floor'); setAreas(data.areas); setTables(data.tables); setError(''); } catch { setError('Floor configuration could not be loaded.'); }
  }
  useEffect(() => { load(); }, []);

  async function submitArea(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      if (areaForm.id) await api.patch(`/floor/areas/${areaForm.id}`, { name: areaForm.name, sortOrder: areaForm.sortOrder });
      else await api.post('/floor/areas', { name: areaForm.name, sortOrder: areaForm.sortOrder });
      setAreaForm(null); setNotice(areaForm.id ? 'Area updated.' : 'Area created.'); await load();
    } catch (err) { setError(err.response?.data?.error || 'The area could not be saved.'); }
    finally { setBusy(false); }
  }

  async function submitTable(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      if (tableForm.id) await api.patch(`/floor/tables/${tableForm.id}`, { code: tableForm.code, name: tableForm.name || null, areaId: tableForm.areaId, capacity: tableForm.capacity, floorPosition: tableForm.floorPosition, status: tableForm.status });
      else await api.post('/floor/tables', { code: tableForm.code, name: tableForm.name || null, areaId: tableForm.areaId, capacity: tableForm.capacity, floorPosition: tableForm.floorPosition });
      setTableForm(null); setNotice(tableForm.id ? 'Table updated.' : 'Table created.'); await load();
    } catch (err) { setError(err.response?.data?.error || 'The table could not be saved.'); }
    finally { setBusy(false); }
  }

  async function toggleArea(area) {
    setBusy(true); setError('');
    try { await api.patch(`/floor/areas/${area.id}`, { active: !area.active }); await load(); }
    catch (err) { setError(err.response?.data?.error || 'The area could not be changed.'); }
    finally { setBusy(false); }
  }

  return <>
    {error && <div className="notice notice-error">{error}</div>}
    {notice && <div className="notice notice-success"><Check size={14} /> {notice}</div>}
    <div className="settings-columns">
      <section className="panel settings-panel">
        <div className="panel-heading padded-heading"><div><span className="section-label">FLOOR AREAS</span><h2>Service areas</h2></div>
          <button className="button button-small button-primary" onClick={() => setAreaForm({ name: '', sortOrder: areas.length + 1 })}><Plus size={14} /> Add area</button></div>
        <div className="settings-list">
          {areaRows.items.map((area, index) => <div className="settings-row" key={area.id}>
            <div className="settings-row-copy"><b>{area.name}</b><small>#{(areaRows.meta.page - 1) * listLimit + index + 1} · Order {area.sortOrder} · {tables.filter((t) => t.areaId === area.id).length} tables{area.active ? '' : ' · inactive'}</small></div>
            <div className="settings-row-actions">
              <button className="icon-button" aria-label={`Edit ${area.name}`} onClick={() => setAreaForm({ id: area.id, name: area.name, sortOrder: area.sortOrder })}><PencilLine size={15} /></button>
              <button className="icon-button" aria-label={`${area.active ? 'Deactivate' : 'Reactivate'} ${area.name}`} disabled={busy} onClick={() => toggleArea(area)}><Trash2 size={15} /></button>
            </div>
          </div>)}
          {!areas.length && <div className="settings-empty"><Layers size={19} /><b>No areas yet</b><span>Create Main Hall, Terrace or VIP to group your tables.</span></div>}
        </div>
        <TablePagination page={areaPage} meta={areaRows.meta} limit={listLimit} onPageChange={setAreaPage} onLimitChange={(value) => { setListLimit(value); setAreaPage(1); setTablePage(1); }} />
      </section>
      <section className="panel settings-panel">
        <div className="panel-heading padded-heading"><div><span className="section-label">TABLES</span><h2>Numbered tables</h2></div>
          <button className="button button-small button-primary" disabled={!areas.some((a) => a.active)} onClick={() => setTableForm({ code: '', name: '', areaId: areas.find((a) => a.active)?.id || '', capacity: 4, floorPosition: tables.length + 1, status: 'available' })}><Plus size={14} /> Add table</button></div>
        <div className="settings-list">
          {tableRows.items.map((table, index) => <div className="settings-row" key={table.id}>
            <div className="settings-row-copy"><b>{table.code}{table.name ? ` · ${table.name}` : ''}</b>
              <small>#{(tableRows.meta.page - 1) * listLimit + index + 1} · {areas.find((a) => a.id === table.areaId)?.name || 'No area'} · {table.capacity} seats · {table.effectiveStatus === 'occupied' ? 'Session open' : table.status.replace('_', ' ')}{table.active ? '' : ' · inactive'}</small></div>
            <div className="settings-row-actions">
              <button className="icon-button" aria-label={`Edit ${table.code}`} disabled={table.effectiveStatus === 'occupied'} onClick={() => setTableForm({ id: table.id, code: table.code, name: table.name || '', areaId: table.areaId, capacity: table.capacity, floorPosition: table.floorPosition, status: table.effectiveStatus === 'occupied' ? 'available' : table.status })}><PencilLine size={15} /></button>
            </div>
          </div>)}
          {!tables.length && <div className="settings-empty"><Armchair size={19} /><b>No tables yet</b><span>Add T01, T02 and so on — customers stay anonymous.</span></div>}
        </div>
        <TablePagination page={tablePage} meta={tableRows.meta} limit={listLimit} onPageChange={setTablePage} onLimitChange={(value) => { setListLimit(value); setAreaPage(1); setTablePage(1); }} />
      </section>
    </div>
    {areaForm && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setAreaForm(null)}>
      <form className="modal" onSubmit={submitArea}>
        <div className="modal-title"><div><span className="section-label">FLOOR AREAS</span><h2>{areaForm.id ? 'Edit area' : 'New service area'}</h2></div><button type="button" className="icon-button" onClick={() => setAreaForm(null)} aria-label="Close"><X size={18} /></button></div>
        <label>Area name<input required maxLength="120" value={areaForm.name} onChange={(event) => setAreaForm({ ...areaForm, name: event.target.value })} placeholder="Main Hall" /></label>
        <label>Sort order<input type="number" min="0" step="1" required value={areaForm.sortOrder} onChange={(event) => setAreaForm({ ...areaForm, sortOrder: event.target.value })} /></label>
        <div className="modal-actions"><button type="button" className="button button-quiet" onClick={() => setAreaForm(null)}>Cancel</button><button className="button button-primary" disabled={busy}>{busy ? 'Saving…' : 'Save area'}</button></div>
      </form>
    </div>}
    {tableForm && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setTableForm(null)}>
      <form className="modal" onSubmit={submitTable}>
        <div className="modal-title"><div><span className="section-label">TABLES</span><h2>{tableForm.id ? `Edit ${tableForm.code}` : 'New table'}</h2></div><button type="button" className="icon-button" onClick={() => setTableForm(null)} aria-label="Close"><X size={18} /></button></div>
        <div className="form-two">
          <label>Table code<input required maxLength="20" value={tableForm.code} onChange={(event) => setTableForm({ ...tableForm, code: event.target.value.toUpperCase() })} placeholder="T01" /></label>
          <label>Display name (optional)<input maxLength="80" value={tableForm.name} onChange={(event) => setTableForm({ ...tableForm, name: event.target.value })} placeholder="Window corner" /></label>
          <label>Area<select required value={tableForm.areaId} onChange={(event) => setTableForm({ ...tableForm, areaId: event.target.value })}>{areas.filter((a) => a.active).map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}</select></label>
          <label>Seat capacity<input type="number" min="0" step="1" value={tableForm.capacity} onChange={(event) => setTableForm({ ...tableForm, capacity: event.target.value })} /></label>
          <label>Display position<input type="number" min="0" step="1" value={tableForm.floorPosition} onChange={(event) => setTableForm({ ...tableForm, floorPosition: event.target.value })} /></label>
          {tableForm.id && <label>Status<select value={tableForm.status} onChange={(event) => setTableForm({ ...tableForm, status: event.target.value })}>{TABLE_STATUS_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>}
        </div>
        <div className="modal-actions"><button type="button" className="button button-quiet" onClick={() => setTableForm(null)}>Cancel</button><button className="button button-primary" disabled={busy}>{busy ? 'Saving…' : 'Save table'}</button></div>
      </form>
    </div>}
  </>;
}

function UnitsSettings() {
  const [products, setProducts] = useState([]);
  const [productPage, setProductPage] = useState(1); const [productLimit, setProductLimit] = useState(10); const [productMeta, setProductMeta] = useState({ page: 1, limit: 10, totalRecords: 0, totalPages: 0 });
  const [selected, setSelected] = useState(null);
  const [units, setUnits] = useState([]);
  const [unitPage, setUnitPage] = useState(1); const [unitLimit, setUnitLimit] = useState(10);
  const [productQuery, setProductQuery] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [unitForm, setUnitForm] = useState(null);
  const unitRows = pageRows(units, unitPage, unitLimit);

  useEffect(() => {
    api.get('/products', { params: { page: productPage, limit: productLimit, search: productQuery } })
      .then(({ data }) => { setProducts(data.items); setProductMeta(data.meta); setProductPage(data.meta.page); })
      .catch(() => setError('Products could not be loaded.'));
  }, [productPage, productLimit, productQuery]);

  async function loadUnits(product) {
    setSelected(product); setUnits([]); setUnitPage(1); setError(''); setNotice('');
    try { const { data } = await api.get(`/products/${product.id}/units`); setUnits(data.items); } catch { setError('Units for this product could not be loaded.'); }
  }

  async function submitUnit(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      if (unitForm.id) await api.patch(`/products/${selected.id}/units/${unitForm.id}`, { unitName: unitForm.unitName, factorToBase: unitForm.factorToBase, sellingPrice: unitForm.sellingPrice, purchasePrice: unitForm.purchasePrice });
      else await api.post(`/products/${selected.id}/units`, { unitName: unitForm.unitName, factorToBase: unitForm.factorToBase, sellingPrice: unitForm.sellingPrice, purchasePrice: unitForm.purchasePrice });
      setUnitForm(null); setNotice(unitForm.id ? 'Unit updated. New transactions use this conversion immediately.' : 'Unit added.');
      await loadUnits(selected);
    } catch (err) { setError(err.response?.data?.error || 'The unit could not be saved.'); }
    finally { setBusy(false); }
  }

  async function toggleUnit(unit) {
    setBusy(true); setError('');
    try { await api.patch(`/products/${selected.id}/units/${unit.id}`, { active: unit.active ? 0 : 1 }); setNotice(unit.active ? 'Unit disabled for future sales.' : 'Unit enabled.'); await loadUnits(selected); }
    catch (err) { setError(err.response?.data?.error || 'The unit could not be changed.'); }
    finally { setBusy(false); }
  }

  return <>
    {error && <div className="notice notice-error">{error}</div>}
    {notice && <div className="notice notice-success"><Check size={14} /> {notice}</div>}
    <div className="settings-columns units-layout">
      <section className="panel settings-panel">
        <div className="panel-heading padded-heading"><div><span className="section-label">SELECT PRODUCT</span><h2>Choose a product</h2></div><SettingsIcon size={17} /></div>
        <div className="search-box"><Search size={16} /><input value={productQuery} onChange={(event) => { setProductQuery(event.target.value); setProductPage(1); }} placeholder="Search products" aria-label="Search products" /></div>
        <div className="settings-list product-select-list">
          {products.map((product, index) => <button type="button" className={`settings-row selectable ${selected?.id === product.id ? 'selected' : ''}`} key={product.id} onClick={() => loadUnits(product)}>
            <div className="settings-row-copy"><b>{product.name}</b><small>#{(productMeta.page - 1) * productLimit + index + 1} · {product.sku ? `SKU ${product.sku} · ` : ''}base: {product.baseUnit}</small></div>
          </button>)}
          {!products.length && <div className="settings-empty"><Package size={19} /><b>No products match</b><span>Try another name or SKU.</span></div>}
        </div>
        <TablePagination page={productPage} meta={productMeta} limit={productLimit} onPageChange={setProductPage} onLimitChange={(value) => { setProductLimit(value); setProductPage(1); }} />
      </section>
      <section className="panel settings-panel">
        <div className="panel-heading padded-heading"><div><span className="section-label">UNITS &amp; CONVERSIONS</span><h2>{selected ? selected.name : 'No product selected'}</h2></div>
          {selected && <button className="button button-small button-primary" onClick={() => setUnitForm({ unitName: '', factorToBase: '', sellingPrice: '', purchasePrice: '' })}><Plus size={14} /> Add unit</button>}</div>
        {selected ? <>
          <p className="units-note">Each product keeps its own conversion. {selected.baseUnit} is the base stock unit — every quantity is stored in it, and crate size is set per product, never globally.</p>
          <div className="table-scroll"><table className="units-table">
            <thead><tr><th>#</th><th>UNIT</th><th>{selected.baseUnit.toUpperCase()}S PER UNIT</th><th>SELLS FOR</th><th>PURCHASE COST</th><th></th></tr></thead>
            <tbody>{unitRows.items.map((unit, index) => <tr key={unit.id} className={unit.active ? '' : 'muted-row'}>
              <td>{(unitRows.meta.page - 1) * unitLimit + index + 1}</td>
              <td><b>{unit.unitName}</b>{Number(unit.isBase) === 1 && <small className="base-tag">base</small>}</td>
              <td>{unit.factorToBase}</td>
              <td>{money(unit.sellingPrice)}</td>
              <td>{money(unit.purchasePrice)}</td>
              <td className="table-actions">
                {Number(unit.isBase) !== 1 && <button className="icon-button" aria-label={`Edit ${unit.unitName}`} disabled={busy} onClick={() => setUnitForm({ id: unit.id, unitName: unit.unitName, factorToBase: unit.factorToBase, sellingPrice: unit.sellingPrice, purchasePrice: unit.purchasePrice })}><PencilLine size={15} /></button>}
                {Number(unit.isBase) !== 1 && <button className="icon-button" aria-label={`${unit.active ? 'Disable' : 'Enable'} ${unit.unitName}`} disabled={busy} onClick={() => toggleUnit(unit)}><Trash2 size={15} /></button>}
              </td>
            </tr>)}</tbody>
          </table></div>
          <TablePagination page={unitPage} meta={unitRows.meta} limit={unitLimit} onPageChange={setUnitPage} onLimitChange={(value) => { setUnitLimit(value); setUnitPage(1); }} />
          <small className="units-footnote">Completed purchases and sales keep the conversion used at the time — changing a crate size only affects future transactions.</small>
        </> : <div className="settings-empty"><Layers size={19} /><b>Pick a product</b><span>Configure how bottles, crates and packs convert for each drink.</span></div>}
      </section>
    </div>
    {unitForm && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setUnitForm(null)}>
      <form className="modal" onSubmit={submitUnit}>
        <div className="modal-title"><div><span className="section-label">PRODUCT UNIT</span><h2>{unitForm.id ? `Edit ${unitForm.unitName}` : `New unit for ${selected?.name}`}</h2></div><button type="button" className="icon-button" onClick={() => setUnitForm(null)} aria-label="Close"><X size={18} /></button></div>
        <div className="form-two">
          <label>Unit name<input required maxLength="40" value={unitForm.unitName} onChange={(event) => setUnitForm({ ...unitForm, unitName: event.target.value })} placeholder="crate" /></label>
          <label>{selected?.baseUnit}s per unit<input required type="number" min="0.001" step="any" value={unitForm.factorToBase} onChange={(event) => setUnitForm({ ...unitForm, factorToBase: event.target.value })} placeholder="e.g. 12 or 24" /></label>
          <label>Selling price (RWF)<input required type="number" min="0" step="0.01" value={unitForm.sellingPrice} onChange={(event) => setUnitForm({ ...unitForm, sellingPrice: event.target.value })} /></label>
          <label>Purchase cost (RWF)<input required type="number" min="0" step="0.01" value={unitForm.purchasePrice} onChange={(event) => setUnitForm({ ...unitForm, purchasePrice: event.target.value })} /></label>
        </div>
        <div className="modal-actions"><button type="button" className="button button-quiet" onClick={() => setUnitForm(null)}>Cancel</button><button className="button button-primary" disabled={busy || !selected}>{busy ? <LoaderCircle size={14} className="spin" /> : 'Save unit'}</button></div>
      </form>
    </div>}
  </>;
}
