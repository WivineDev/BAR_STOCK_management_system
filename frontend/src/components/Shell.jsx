import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { BarChart3, Beer, Boxes, CircleDollarSign, FolderTree, LayoutDashboard, LogOut, Menu, Receipt, ShoppingCart, Truck, Users } from 'lucide-react';
import { useAuth } from '../state/AuthContext.jsx';
import { useState } from 'react';

const navigation = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/pos', label: 'Point of sale', icon: ShoppingCart, roles: ['owner', 'manager', 'cashier'] },
  { to: '/sales', label: 'Sales', icon: Receipt, roles: ['owner', 'manager', 'cashier', 'accountant'] },
  { to: '/products', label: 'Products', icon: Beer, roles: ['owner', 'manager', 'storekeeper'] },
  { to: '/categories', label: 'Categories', icon: FolderTree, roles: ['owner', 'manager'] },
  { to: '/inventory', label: 'Inventory', icon: Boxes, roles: ['owner', 'manager', 'storekeeper'] },
  { to: '/purchases', label: 'Purchases', icon: ShoppingCart, roles: ['owner', 'manager', 'storekeeper', 'accountant'] },
  { to: '/suppliers', label: 'Suppliers', icon: Truck, roles: ['owner', 'manager', 'accountant'] },
  { to: '/customers', label: 'Customers & credit', icon: Users, roles: ['owner', 'manager', 'cashier', 'accountant'] },
  { to: '/reports', label: 'Reports', icon: BarChart3, roles: ['owner', 'manager', 'accountant'] },
  { to: '/expenses', label: 'Expenses', icon: Receipt, roles: ['owner', 'manager', 'accountant'] },
  { to: '/cash', label: 'Cash management', icon: CircleDollarSign, roles: ['owner', 'manager', 'cashier', 'accountant'] },
  { to: '/users', label: 'Users', icon: Users, roles: ['owner'] },
];
const titles = { '/': 'Overview', '/pos': 'Point of sale', '/sales': 'Sales', '/products': 'Products', '/categories': 'Categories', '/inventory': 'Inventory', '/purchases': 'Purchases', '/suppliers': 'Suppliers', '/customers': 'Customers & credit', '/reports': 'Reports', '/expenses': 'Expenses', '/cash': 'Cash management', '/users': 'Users' };
export default function Shell() {
  const { user, logout } = useAuth(); const [open, setOpen] = useState(false); const location = useLocation();
  return <div className="app-shell">
    <aside className={`sidebar ${open ? 'sidebar-open' : ''}`}>
      <div className="brand"><div className="brand-mark"><Beer size={20} /></div><div><b>barwise</b><small>STOCK & SALES</small></div></div>
      <div className="side-label">WORKSPACE</div>
      <nav>{navigation.filter((item) => !item.roles || item.roles.includes(user?.role)).map(({ to, label, icon: Icon, end }) => <NavLink key={to} to={to} end={end} onClick={() => setOpen(false)} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}><Icon size={18} strokeWidth={1.8} /><span>{label}</span>{label === 'Inventory' && <span className="nav-dot" />}</NavLink>)}</nav>
      <div className="sidebar-bottom"><div className="help-card"><div className="help-icon"><BarChart3 size={17} /></div><b>Built for the daily shift</b><p>Stock, sales, and cash together in one place.</p></div><button className="profile-button" onClick={logout}><div className="avatar">{(user?.name || 'O').slice(0,1).toUpperCase()}</div><div className="profile-copy"><b>{user?.name}</b><small>{user?.role || 'Owner'}</small></div><LogOut size={16} /></button></div>
    </aside>
    <main className="main-panel"><header className="topbar"><button className="mobile-menu icon-button" onClick={() => setOpen(!open)} aria-label="Toggle navigation"><Menu size={19} /></button><div className="crumb">Workspace <span>/</span> <b>{titles[location.pathname] || 'Overview'}</b></div><div className="top-actions"><div className="business-chip"><span className="status-pip" /> {user?.businessName || 'My business'}</div><div className="avatar avatar-small">{(user?.name || 'O').slice(0,1).toUpperCase()}</div></div></header><div className="page-wrap"><Outlet /></div></main>
  </div>;
}
