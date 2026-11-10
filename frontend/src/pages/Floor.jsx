import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Armchair, Clock, LayoutGrid, Loader2, Plus, Settings as SettingsIcon, Users } from 'lucide-react';
import api from '../services/api.js';
import { useAuth } from '../state/AuthContext.jsx';

const money = (n) => new Intl.NumberFormat('en-RW', { style: 'currency', currency: 'RWF', maximumFractionDigits: 0 }).format(Number(n || 0));
const elapsed = (from) => {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(from).getTime()) / 60000));
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
};
const STATUS_LABEL = { available: 'Available', occupied: 'Occupied', reserved: 'Reserved', out_of_service: 'Out of service' };

export default function Floor() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [areas, setAreas] = useState([]);
  const [tables, setTables] = useState([]);
  const [areaFilter, setAreaFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [busyTable, setBusyTable] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  async function load() {
    try { const { data } = await api.get('/floor'); setAreas(data.areas.filter((area) => area.active)); setTables(data.tables); setError(''); }
    catch { setError('The floor plan could not be loaded.'); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);
  useEffect(() => { const timer = setInterval(() => setTick((value) => value + 1), 60000); return () => clearInterval(timer); }, []);

  const shown = useMemo(() => tables.filter((table) => table.active && (!areaFilter || table.areaId === areaFilter) && (!statusFilter || table.effectiveStatus === statusFilter)), [tables, areaFilter, statusFilter]);
  const openTabs = tables.filter((table) => table.effectiveStatus === 'occupied');
  const outstanding = openTabs.reduce((sum, table) => sum + Number(table.billTotal) - Number(table.paidTotal), 0);

  async function openTable(table) {
    setBusyTable(table.id); setError('');
    try {
      const { data } = await api.post(`/floor/tables/${table.id}/sessions`);
      navigate(`/pos?session=${data.session.id}`);
    } catch (err) { setError(err.response?.data?.error || 'The table could not be opened.'); }
    finally { setBusyTable(''); }
  }

  return <div className="content-page floor-page">
    <div className="page-heading">
      <div>
        <div className="date-label">TABLE SERVICE</div>
        <h1>Floor &amp; tables</h1>
        <p>Tap an open table to resume its bill, or open a free table to start service. Walk-in sales stay on the POS.</p>
      </div>
      {['owner', 'manager'].includes(user?.role) && <button className="button button-outline" onClick={() => navigate('/settings')}><SettingsIcon size={15} /> Configure floor</button>}
    </div>
    {error && <div className="notice notice-error">{error}</div>}
    {loading ? <div className="panel floor-empty-state"><Loader2 size={20} className="spin" /> Loading the floor plan…</div> : <>
      {!tables.length ? <div className="panel floor-empty-state">
        <div className="empty-icon"><LayoutGrid size={22} /></div>
        <b>No tables configured yet</b>
        <span>Set up your floor areas and numbered tables in Settings to start table service.</span>
        {['owner', 'manager'].includes(user?.role) && <button className="button button-primary" onClick={() => navigate('/settings')}><Plus size={15} /> Open floor settings</button>}
      </div> : <>
        <div className="floor-summary">
          <div><b>{tables.filter((t) => t.effectiveStatus === 'available').length}</b><span>Free tables</span></div>
          <div><b>{openTabs.length}</b><span>Open tabs</span></div>
          <div><b>{money(outstanding)}</b><span>Outstanding bills</span></div>
          <div><b>{tables.filter((t) => t.effectiveStatus === 'reserved').length}</b><span>Reserved</span></div>
          <div><b>{tables.filter((t) => t.effectiveStatus === 'out_of_service').length}</b><span>Out of service</span></div>
        </div>
        <div className="filter-row">
          <button type="button" className={`pos-category-chip ${!areaFilter ? 'active' : ''}`} onClick={() => setAreaFilter('')}>All areas</button>
          {areas.map((area) => <button type="button" className={`pos-category-chip ${areaFilter === area.id ? 'active' : ''}`} key={area.id} onClick={() => setAreaFilter(areaFilter === area.id ? '' : area.id)}>{area.name}</button>)}
          <span className="filter-divider" />
          {[['', 'Any status'], ['available', 'Free'], ['occupied', 'Open tabs'], ['reserved', 'Reserved']].map(([value, label]) => (
            <button type="button" className={`pos-category-chip ${statusFilter === value ? 'active' : ''}`} key={value || 'any'} onClick={() => setStatusFilter(value)}>{label}</button>
          ))}
        </div>
        {areas.map((area) => {
          const areaTables = shown.filter((table) => table.areaId === area.id);
          if (!areaTables.length) return null;
          return <section className="floor-area" key={area.id}>
            <header><span className="section-label">{area.name.toUpperCase()}</span><b>{areaTables.length} tables</b></header>
            <div className="floor-grid">{areaTables.map((table) => {
              const occupied = table.effectiveStatus === 'occupied';
              const balance = Number(table.billTotal) - Number(table.paidTotal);
              return <article key={table.id} className={`table-card status-${table.effectiveStatus}`} data-tick={tick}>
                <button type="button" className="table-card-main" disabled={busyTable === table.id || (!occupied && table.effectiveStatus !== 'available') || undefined}
                  onClick={() => (occupied ? navigate(`/pos?session=${table.sessionId}`) : openTable(table))}>
                  <div className="table-card-head">
                    <b>{table.code}</b>
                    <span className={`table-status-pill status-${table.effectiveStatus}`}>{STATUS_LABEL[table.effectiveStatus]}</span>
                  </div>
                  {table.name && <small className="table-card-name">{table.name}</small>}
                  <div className="table-card-meta">
                    <span><Armchair size={13} /> {table.capacity || '—'} seats</span>
                    {occupied && <span><Users size={13} /> {table.waiterName || 'Unassigned'}</span>}
                    {occupied && <span><Clock size={13} /> {elapsed(table.openedAt)}</span>}
                  </div>
                  {occupied && <div className="table-card-bill">
                    <span>Bill {money(table.billTotal)}</span>
                    <span>Paid {money(table.paidTotal)}</span>
                    <b className={balance > 0 ? 'due' : 'settled'}>{balance > 0 ? `${money(balance)} due` : 'Settled'}</b>
                  </div>}
                  {!occupied && table.effectiveStatus === 'available' && <div className="table-card-open">{busyTable === table.id ? <><Loader2 size={13} className="spin" /> Opening…</> : 'Tap to open service'}</div>}
                  {(table.effectiveStatus === 'reserved' || table.effectiveStatus === 'out_of_service') && <div className="table-card-note">Not openable right now</div>}
                </button>
              </article>;
            })}</div>
          </section>;
        })}
        {!shown.length && <div className="panel floor-empty-state"><b>No tables match this filter.</b></div>}
      </>}
    </>}
  </div>;
}
