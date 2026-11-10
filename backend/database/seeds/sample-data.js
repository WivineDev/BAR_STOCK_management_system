import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';

const prisma = new PrismaClient();

const demoBusiness = {
  name: 'Bistro Royale',
  currency: 'RWF',
  address: 'KG 7 Ave, Kigali, Rwanda',
  phone: '+250788205000',
};

const demoBranchName = 'Main branch';
const demoPassword = 'DemoPass123';

async function getBusiness(tx) {
  const businesses = await tx.$queryRaw`SELECT * FROM businesses ORDER BY created_at ASC LIMIT 1`;
  if (businesses.length > 0) {
    return businesses[0];
  }

  const businessId = randomUUID();
  await tx.$executeRaw`INSERT INTO businesses (id, name, currency, address, phone, created_at, updated_at)
    VALUES (${businessId}, ${demoBusiness.name}, ${demoBusiness.currency}, ${demoBusiness.address}, ${demoBusiness.phone}, NOW(), NOW())`;

  return { id: businessId, name: demoBusiness.name, currency: demoBusiness.currency };
}

async function getBranch(tx, businessId) {
  const branches = await tx.$queryRaw`SELECT * FROM branches WHERE business_id = ${businessId} ORDER BY created_at ASC LIMIT 1`;
  if (branches.length > 0) {
    return branches[0];
  }

  const branchId = randomUUID();
  await tx.$executeRaw`INSERT INTO branches (id, business_id, name, address, active, created_at)
    VALUES (${branchId}, ${businessId}, ${demoBranchName}, ${demoBusiness.address}, 1, NOW())`;

  return { id: branchId, businessId, name: demoBranchName };
}

async function ensureUsers(tx, businessId, branchId) {
  const users = await tx.$queryRaw`SELECT * FROM users WHERE business_id = ${businessId} ORDER BY created_at ASC`;
  if (users.length > 0) {
    return {
      owner: users.find((user) => user.role === 'owner') || users[0],
      manager: users.find((user) => user.role === 'manager') || users[0],
      cashier: users.find((user) => user.role === 'cashier') || users[0],
    };
  }

  const passwordHash = await bcrypt.hash(demoPassword, 12);
  const ownerId = randomUUID();
  const managerId = randomUUID();
  const cashierId = randomUUID();

  await tx.$executeRaw`INSERT INTO users (id, business_id, branch_id, name, email, password_hash, role, active, created_at, updated_at)
    VALUES (${ownerId}, ${businessId}, ${branchId}, ${'Alice Ndayisenga'}, ${'owner@demo.local'}, ${passwordHash}, ${'owner'}, 1, NOW(), NOW())`;
  await tx.$executeRaw`INSERT INTO users (id, business_id, branch_id, name, email, password_hash, role, active, created_at, updated_at)
    VALUES (${managerId}, ${businessId}, ${branchId}, ${'Kevin Mugabo'}, ${'manager@demo.local'}, ${passwordHash}, ${'manager'}, 1, NOW(), NOW())`;
  await tx.$executeRaw`INSERT INTO users (id, business_id, branch_id, name, email, password_hash, role, active, created_at, updated_at)
    VALUES (${cashierId}, ${businessId}, ${branchId}, ${'Mireille Uwase'}, ${'cashier@demo.local'}, ${passwordHash}, ${'cashier'}, 1, NOW(), NOW())`;

  return {
    owner: { id: ownerId, role: 'owner' },
    manager: { id: managerId, role: 'manager' },
    cashier: { id: cashierId, role: 'cashier' },
  };
}

async function ensureCategories(tx, businessId) {
  const categories = await tx.$queryRaw`SELECT * FROM product_categories WHERE business_id = ${businessId}`;
  const existing = new Map(categories.map((category) => [category.name, category]));
  const records = {};

  for (const name of ['Beer', 'Soft Drinks', 'Snacks', 'Mixers']) {
    if (!existing.has(name)) {
      const categoryId = randomUUID();
      await tx.$executeRaw`INSERT INTO product_categories (id, business_id, name, created_at)
        VALUES (${categoryId}, ${businessId}, ${name}, NOW())`;
      records[name] = { id: categoryId, name };
    } else {
      records[name] = existing.get(name);
    }
  }

  return records;
}

async function ensureProducts(tx, businessId, branchId, categories) {
  const productList = [
    { name: 'Prime Lager', sku: 'B-001', baseUnit: 'bottle', sellingPrice: 2200, costPrice: 1500, category: 'Beer', lowStock: 10 },
    { name: 'Malt Lager', sku: 'B-002', baseUnit: 'bottle', sellingPrice: 2500, costPrice: 1650, category: 'Beer', lowStock: 10 },
    { name: 'Coca-Cola 500ml', sku: 'SD-001', baseUnit: 'bottle', sellingPrice: 1200, costPrice: 600, category: 'Soft Drinks', lowStock: 12 },
    { name: 'Lemon Soda 330ml', sku: 'SD-002', baseUnit: 'bottle', sellingPrice: 1000, costPrice: 500, category: 'Soft Drinks', lowStock: 12 },
    { name: 'Chips & Salsa', sku: 'SN-001', baseUnit: 'pack', sellingPrice: 1800, costPrice: 950, category: 'Snacks', lowStock: 8 },
    { name: 'Crispy Chicken', sku: 'SN-002', baseUnit: 'plate', sellingPrice: 4200, costPrice: 2600, category: 'Snacks', lowStock: 6 },
    { name: 'Pineapple Mixer', sku: 'MX-001', baseUnit: 'bottle', sellingPrice: 1500, costPrice: 800, category: 'Mixers', lowStock: 10 },
  ];

  const existingProducts = await tx.$queryRaw`SELECT * FROM products WHERE business_id = ${businessId}`;
  const existingByName = new Map(existingProducts.map((product) => [product.name, product]));
  const owner = (await tx.$queryRaw`SELECT id FROM users WHERE business_id = ${businessId} AND role = 'owner' LIMIT 1`)[0];

  for (const product of productList) {
    if (existingByName.has(product.name)) {
      continue;
    }

    const productId = randomUUID();
    await tx.$executeRaw`INSERT INTO products (id, business_id, branch_id, category_id, name, sku, base_unit, selling_price, cost_price, low_stock_threshold, active, created_at, updated_at)
      VALUES (${productId}, ${businessId}, ${branchId}, ${categories[product.category].id}, ${product.name}, ${product.sku}, ${product.baseUnit}, ${Number(product.sellingPrice)}, ${Number(product.costPrice)}, ${Number(product.lowStock)}, 1, NOW(), NOW())`;

    const currentQty = product.name.includes('Crispy') ? 12 : product.name.includes('Chips') ? 15 : 20;
    await tx.$executeRaw`INSERT INTO inventory (id, business_id, branch_id, product_id, quantity, updated_at)
      VALUES (${randomUUID()}, ${businessId}, ${branchId}, ${productId}, ${currentQty}, NOW())`;
    await tx.$executeRaw`INSERT INTO stock_movements (id, business_id, branch_id, product_id, user_id, movement_type, quantity_delta, unit, reference_type, reference_id, notes, created_at)
      VALUES (${randomUUID()}, ${businessId}, ${branchId}, ${productId}, ${owner?.id}, 'opening', ${currentQty}, ${product.baseUnit}, 'initial_stock', ${productId}, ${'Opening stock for ' + product.name}, NOW())`;
    existingByName.set(product.name, { id: productId, name: product.name, base_unit: product.baseUnit });
  }

  await tx.$executeRaw`
    INSERT INTO product_units (id, business_id, product_id, unit_name, factor_to_base, selling_price, purchase_price, is_base)
    SELECT UUID(), p.business_id, p.id, p.base_unit, 1, p.selling_price, p.cost_price, 1
    FROM products p
    WHERE p.business_id = ${businessId}
      AND NOT EXISTS (SELECT 1 FROM product_units pu WHERE pu.product_id = p.id AND pu.is_base = 1)`;

  return await tx.$queryRaw`SELECT * FROM products WHERE business_id = ${businessId} ORDER BY created_at ASC`;
}

async function ensureCustomers(tx, businessId) {
  const customers = await tx.$queryRaw`SELECT * FROM customers WHERE business_id = ${businessId} ORDER BY created_at ASC LIMIT 10`;
  if (customers.length > 0) {
    return customers;
  }

  const customerRows = [
    { name: 'Grace Umutoni', phone: '+250788100111', email: 'grace@example.com', address: 'Remera, Kigali', notes: 'VIP customer' },
    { name: 'Eric Nkurunziza', phone: '+250788200222', email: 'eric@example.com', address: 'Kacyiru, Kigali', notes: 'Regular walk-in' },
  ];

  for (const customer of customerRows) {
    await tx.$executeRaw`INSERT INTO customers (id, business_id, full_name, phone, email, address, notes, active, created_at, updated_at)
      VALUES (${randomUUID()}, ${businessId}, ${customer.name}, ${customer.phone}, ${customer.email}, ${customer.address}, ${customer.notes}, 1, NOW(), NOW())`;
  }

  return await tx.$queryRaw`SELECT * FROM customers WHERE business_id = ${businessId} ORDER BY created_at ASC LIMIT 10`;
}

async function findProductByName(tx, businessId, productName) {
  const rows = await tx.$queryRaw`SELECT * FROM products WHERE business_id = ${businessId} AND name = ${productName} LIMIT 1`;
  return rows[0] || null;
}

async function ensureSales(tx, businessId, branchId, cashierId, customerId, products) {
  const salesCount = Number((await tx.$queryRaw`SELECT COUNT(*) AS count FROM sales WHERE business_id = ${businessId}`)[0].count);
  if (salesCount > 0) {
    return;
  }

  const [customer] = await tx.$queryRaw`SELECT * FROM customers WHERE business_id = ${businessId} LIMIT 1`;
  const productByName = new Map(products.map((product) => [product.name, product]));

  const saleId = randomUUID();
  const saleItems = [
    { product: 'Prime Lager', qty: 2, price: 2200, cost: 1500 },
    { product: 'Coca-Cola 500ml', qty: 3, price: 1200, cost: 600 },
  ];
  const subtotal = saleItems.reduce((sum, item) => sum + item.qty * item.price, 0);

  await tx.$executeRaw`INSERT INTO sales (id, business_id, branch_id, cashier_id, customer_id, reference, idempotency_key, status, subtotal, discount_amount, tax_amount, total, amount_paid, balance_due, cost_of_goods_sold, created_at)
    VALUES (${saleId}, ${businessId}, ${branchId}, ${cashierId}, ${customer?.id || customerId}, 'INV-1001', 'INV-1001-key', 'completed', ${subtotal}, 0, 0, ${subtotal}, ${subtotal}, 0, ${subtotal}, NOW())`;

  for (const item of saleItems) {
    const product = productByName.get(item.product) ?? (await findProductByName(tx, businessId, item.product));
    if (!product) {
      throw new Error(`Missing product: ${item.product}`);
    }

    const lineTotal = item.qty * item.price;
    const lineCost = item.qty * item.cost;
    await tx.$executeRaw`INSERT INTO sale_items (id, business_id, branch_id, sale_id, product_id, product_name, quantity, unit, unit_price, unit_cost, line_total, line_cost, created_at)
      VALUES (${randomUUID()}, ${businessId}, ${branchId}, ${saleId}, ${product.id}, ${product.name}, ${item.qty}, ${product.base_unit}, ${item.price}, ${item.cost}, ${lineTotal}, ${lineCost}, NOW())`;

    await tx.$executeRaw`INSERT INTO stock_movements (id, business_id, branch_id, product_id, user_id, movement_type, quantity_delta, unit, reference_type, reference_id, notes, created_at)
      VALUES (${randomUUID()}, ${businessId}, ${branchId}, ${product.id}, ${cashierId}, 'sale', ${-item.qty}, ${product.base_unit}, 'sale', ${saleId}, ${'Sold ' + item.qty + ' ' + product.name}, NOW())`;
  }

  await tx.$executeRaw`INSERT INTO sale_payments (id, business_id, branch_id, sale_id, user_id, method, amount, created_at)
    VALUES (${randomUUID()}, ${businessId}, ${branchId}, ${saleId}, ${cashierId}, 'cash', ${subtotal}, NOW())`;

  const secondSaleId = randomUUID();
  const secondSubtotal = 5400;
  const secondItem = productByName.get('Crispy Chicken') ?? (await findProductByName(tx, businessId, 'Crispy Chicken'));
  if (!secondItem) {
    throw new Error('Missing product: Crispy Chicken');
  }

  await tx.$executeRaw`INSERT INTO sales (id, business_id, branch_id, cashier_id, customer_id, reference, idempotency_key, status, subtotal, discount_amount, tax_amount, total, amount_paid, balance_due, cost_of_goods_sold, created_at)
    VALUES (${secondSaleId}, ${businessId}, ${branchId}, ${cashierId}, ${customer?.id || customerId}, 'INV-1002', 'INV-1002-key', 'completed', ${secondSubtotal}, 0, 0, ${secondSubtotal}, ${secondSubtotal}, 0, 2300, NOW())`;

  await tx.$executeRaw`INSERT INTO sale_items (id, business_id, branch_id, sale_id, product_id, product_name, quantity, unit, unit_price, unit_cost, line_total, line_cost, created_at)
    VALUES (${randomUUID()}, ${businessId}, ${branchId}, ${secondSaleId}, ${secondItem.id}, ${secondItem.name}, 1, ${secondItem.base_unit}, 4200, 2600, 4200, 2600, NOW())`;
  await tx.$executeRaw`INSERT INTO sale_payments (id, business_id, branch_id, sale_id, user_id, method, amount, created_at)
    VALUES (${randomUUID()}, ${businessId}, ${branchId}, ${secondSaleId}, ${cashierId}, 'mobile_money', ${secondSubtotal}, NOW())`;
  await tx.$executeRaw`INSERT INTO stock_movements (id, business_id, branch_id, product_id, user_id, movement_type, quantity_delta, unit, reference_type, reference_id, notes, created_at)
    VALUES (${randomUUID()}, ${businessId}, ${branchId}, ${secondItem.id}, ${cashierId}, 'sale', -1, ${secondItem.base_unit}, 'sale', ${secondSaleId}, 'Sold one Crispy Chicken plate', NOW())`;
}

async function ensureCashSession(tx, businessId, branchId, cashierId) {
  const sessions = await tx.$queryRaw`SELECT * FROM cash_sessions WHERE business_id = ${businessId} ORDER BY opened_at ASC LIMIT 1`;
  if (sessions.length > 0) {
    return sessions[0];
  }

  const sessionId = randomUUID();
  await tx.$executeRaw`INSERT INTO cash_sessions (id, business_id, branch_id, user_id, opening_balance, expected_cash, actual_cash, discrepancy_note, status, opened_at, closed_at)
    VALUES (${sessionId}, ${businessId}, ${branchId}, ${cashierId}, 100000, 100000, 100000, NULL, 'open', NOW(), NULL)`;
  await tx.$executeRaw`INSERT INTO cash_movements (id, business_id, branch_id, session_id, user_id, movement_type, direction, amount, reference_type, reference_id, notes, created_at)
    VALUES (${randomUUID()}, ${businessId}, ${branchId}, ${sessionId}, ${cashierId}, 'opening_float', 'in', 100000, 'cash_session', ${sessionId}, 'Opening float for shift', NOW())`;

  return { id: sessionId };
}

async function main() {
  await prisma.$transaction(async (tx) => {
    const business = await getBusiness(tx);
    const branch = await getBranch(tx, business.id);
    const users = await ensureUsers(tx, business.id, branch.id);
    const categories = await ensureCategories(tx, business.id);
    const products = await ensureProducts(tx, business.id, branch.id, categories);
    const customers = await ensureCustomers(tx, business.id);
    await ensureSales(tx, business.id, branch.id, users.cashier.id, customers[0]?.id || null, products);
    const session = await ensureCashSession(tx, business.id, branch.id, users.cashier.id);

    console.log(JSON.stringify({
      business: business.name,
      branch: branch.name,
      login: {
        owner: 'owner@demo.local',
        manager: 'manager@demo.local',
        cashier: 'cashier@demo.local',
        password: demoPassword,
      },
      categories: Object.keys(categories).length,
      products: products.length,
      customers: customers.length,
      cashSession: session.id,
      note: 'Demo data is ready for local testing.',
    }, null, 2));
  });
}

main().catch((error) => {
  console.error('Seed failed:', error);
  process.exitCode = 1;
}).finally(async () => {
  await prisma.$disconnect();
});
