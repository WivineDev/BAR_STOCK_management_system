import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  BarChart3,
  BookUser,
  Boxes,
  CircleDollarSign,
  FolderTree,
  LayoutDashboard,
  LayoutGrid,
  LogOut,
  Martini,
  Menu,
  Package,
  PackagePlus,
  Receipt,
  ReceiptText,
  Settings as SettingsIcon,
  ShoppingCart,
  Truck,
  UserCog,
} from 'lucide-react';
import { useAuth } from '../state/AuthContext.jsx';

const navigation = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/pos', label: 'Point of sale', icon: ShoppingCart, roles: ['owner', 'manager', 'cashier'] },
  { to: '/floor', label: 'Floor & tables', icon: LayoutGrid, roles: ['owner', 'manager', 'cashier'] },
  { to: '/sales', label: 'Sales', icon: Receipt, roles: ['owner', 'manager', 'cashier', 'accountant'] },
  { to: '/products', label: 'Products', icon: Package, roles: ['owner', 'manager', 'storekeeper'] },
  { to: '/categories', label: 'Categories', icon: FolderTree, roles: ['owner', 'manager'] },
  { to: '/inventory', label: 'Inventory', icon: Boxes, roles: ['owner', 'manager', 'storekeeper'] },
  { to: '/purchases', label: 'Purchases', icon: PackagePlus, roles: ['owner', 'manager', 'storekeeper', 'accountant'] },
  { to: '/suppliers', label: 'Suppliers', icon: Truck, roles: ['owner', 'manager', 'accountant'] },
  { to: '/customers', label: 'Customers & credit', icon: BookUser, roles: ['owner', 'manager', 'cashier', 'accountant'] },
  { to: '/reports', label: 'Reports', icon: BarChart3, roles: ['owner', 'manager', 'accountant'] },
  { to: '/expenses', label: 'Expenses', icon: ReceiptText, roles: ['owner', 'manager', 'accountant'] },
  { to: '/cash', label: 'Cash management', icon: CircleDollarSign, roles: ['owner', 'manager', 'cashier', 'accountant'] },
  { to: '/users', label: 'Users', icon: UserCog, roles: ['owner'] },
  { to: '/settings', label: 'Settings', icon: SettingsIcon, roles: ['owner', 'manager'] },
];

const titles = {
  '/': 'Overview',
  '/pos': 'Point of sale',
  '/floor': 'Floor & tables',
  '/settings': 'Settings',
  '/sales': 'Sales',
  '/products': 'Products',
  '/categories': 'Categories',
  '/inventory': 'Inventory',
  '/purchases': 'Purchases',
  '/suppliers': 'Suppliers',
  '/customers': 'Customers & credit',
  '/reports': 'Reports',
  '/expenses': 'Expenses',
  '/cash': 'Cash management',
  '/users': 'Users',
};

export default function Shell() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const initials = (user?.name || 'O').slice(0, 1).toUpperCase();

  useEffect(() => setOpen(false), [location.pathname]);

  useEffect(() => {
    if (!open) return undefined;
    function closeOnEscape(event) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [open]);

  return (
    <div className="app-shell">
      <aside className={`sidebar ${open ? 'sidebar-open' : ''}`}>
        <div className="brand">
          <div className="brand-mark"><Martini size={20} /></div>
          <div><b>Umucyobar</b><small>STOCK &amp; SALES</small></div>
        </div>
        <div className="side-label">WORKSPACE</div>
        <nav id="primary-navigation">
          {navigation.filter((item) => !item.roles || item.roles.includes(user?.role)).map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              onClick={() => setOpen(false)}
              className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
            >
              <Icon size={18} strokeWidth={1.8} />
              <span>{label}</span>
              {label === 'Inventory' && <span className="nav-dot" />}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="help-card">
            <div className="help-icon"><BarChart3 size={17} /></div>
            <b>Built for the daily shift</b>
            <p>Stock, sales, and cash together in one place.</p>
          </div>
          <div className="profile-button">
            <div className="avatar">{initials}</div>
            <div className="profile-copy">
              <b>{user?.name}</b>
              <small>{user?.role || 'Owner'}</small>
            </div>
          </div>
        </div>
      </aside>
      {open && <button className="sidebar-backdrop" type="button" aria-label="Close navigation" onClick={() => setOpen(false)} />}
      <main className="main-panel">
        <header className="topbar">
          <button
            className="mobile-menu icon-button"
            onClick={() => setOpen(!open)}
            aria-label="Toggle navigation"
            aria-expanded={open}
            aria-controls="primary-navigation"
          >
            <Menu size={19} />
          </button>
          <div className="crumb">Workspace <span>/</span> <b>{titles[location.pathname] || 'Overview'}</b></div>
          <div className="top-actions">
            <div className="business-chip"><span className="status-pip" /> {user?.businessName || 'Umucyobar'}</div>
            <div className="avatar avatar-small" aria-label={`Signed in as ${user?.name || 'owner'}`}>{initials}</div>
            <button className="button button-quiet logout-action" onClick={logout} title="Sign out of your account">
              <LogOut size={15} />
              <span>Log out</span>
            </button>
          </div>
        </header>
        <div className="page-wrap"><Outlet /></div>
      </main>
    </div>
  );
}
