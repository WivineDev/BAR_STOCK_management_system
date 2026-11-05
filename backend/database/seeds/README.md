# Seed data

The application intentionally has no default credentials or production-like sample transactions. Create the first owner through the one-time `POST /api/auth/bootstrap` endpoint in a private local environment. It creates the business, main branch, and owner account. Product and stock records should be entered from the UI so that audit history remains meaningful.
