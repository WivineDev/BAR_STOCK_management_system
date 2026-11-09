import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './state/AuthContext.jsx';
import Shell from './components/Shell.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Products from './pages/Products.jsx';
import PointOfSale from './pages/PointOfSale.jsx';
import Inventory from './pages/Inventory.jsx';
import Expenses from './pages/Expenses.jsx';
import CashManagement from './pages/CashManagement.jsx';
import Suppliers from './pages/Suppliers.jsx';
import Purchases from './pages/Purchases.jsx';
import Customers from './pages/Customers.jsx';
import Sales from './pages/Sales.jsx';
import Users from './pages/Users.jsx';
import Reports from './pages/Reports.jsx';
import Categories from './pages/Categories.jsx';
import Welcome from './pages/Welcome.jsx';

function Protected({ children }) { const { user, ready } = useAuth(); if (!ready) return <div className="loading-screen">Loading your workspace…</div>; return user ? children : <Navigate to="/welcome" replace />; }
export default function App() {
  const { user, ready } = useAuth();
  if (!ready) return <div className="loading-screen">Loading your workspace…</div>;
  return <Routes>
    <Route path="/welcome" element={user ? <Navigate to="/" replace /> : <Welcome />} />
    <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
    <Route path="/" element={<Protected><Shell /></Protected>}>
      <Route index element={<Dashboard />} />
      <Route path="pos" element={<PointOfSale />} />
      <Route path="sales" element={<Sales />} />
      <Route path="products" element={<Products />} />
      <Route path="categories" element={<Categories />} />
      <Route path="inventory" element={<Inventory />} />
      <Route path="purchases" element={<Purchases />} />
      <Route path="suppliers" element={<Suppliers />} />
      <Route path="customers" element={<Customers />} />
      <Route path="expenses" element={<Expenses />} />
      <Route path="cash" element={<CashManagement />} />
      <Route path="users" element={<Users />} />
      <Route path="reports" element={<Reports />} />
    </Route>
    <Route path="*" element={<Navigate to={user ? '/' : '/welcome'} replace />} />
  </Routes>;
}
