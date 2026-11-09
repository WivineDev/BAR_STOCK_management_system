# BSSBMS · Bar Stock, Sales and Business Management System

A React and Express business management application using Prisma with MySQL. This repository is under active development, not a production-ready commercial release. It supports owner/staff authentication, role-gated access, products, categories and packaging, auditable stock adjustments, suppliers and purchases with weighted-average costing, sales and purchase returns, POS sales with split payments, customer/supplier balances, expenses, cash reconciliation, receipts, dashboard metrics, return-aware reports, and audit viewing.

## Requirements

- Node.js 20 or later.
- MySQL 8 or compatible MariaDB from XAMPP.
- npm.

## Quick start

1. Start MySQL in XAMPP and create a fresh `bssbms` database. If that name already exists, select a new local database name in `backend/.env`; the migration runner refuses unmarked existing schemas.
2. Copy `backend/.env.example` to `backend/.env`. Set `DATABASE_URL` for your MySQL database and a random JWT secret with at least 32 characters. URL-encode special characters in the database username or password.
3. From the repository root, run `npm.cmd install` on PowerShell (or `npm install` in a shell where npm is enabled).
4. Generate the Prisma client with `npm run db:generate -w backend`.
5. Apply the schema with `npm run migrate -w backend`.
6. Start both apps with `npm run dev`.
7. Open `http://localhost:5173` and create the first owner account.

The API defaults to `http://localhost:5000`; this workspace's ignored local environment files use port 5102 because port 5000 is already occupied on this computer. See [installation](documentation/installation-guide.md), [API reference](documentation/api-documentation.md), and [phase status](documentation/phase-status.md).

## Current limitations

Customer and supplier statements/history, granular permission configuration, password reset, notification workflows, business settings, PDF/XLSX exports, scheduled backups and restore verification, and production deployment remain to be built. Product edits preserve weighted-average cost and the original base unit. Return values and debt/refund effects are recorded transactionally; supplier returns above the payable require an immediate refund, and carry-forward supplier credits are not supported. Cash tender/change and tax/discount calculations are not modeled. Transaction concurrency and failure recovery still need broader verification. Do not use this development release as the sole ledger for a live business; see [phase status](documentation/phase-status.md) for verification details and the isolated local database configuration.
