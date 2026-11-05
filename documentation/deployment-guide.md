# Deployment guide (preparation only)

Production deployment is not configured or verified. Use a managed MySQL deployment with TLS, a dedicated least-privilege DB account, HTTPS termination, a strong secret manager value, restricted CORS origins, and private network rules. Set `NODE_ENV=production`, configure `FRONTEND_URL`, deploy the Vite `dist/` bundle behind HTTPS, and run reviewed migrations before starting the API.

Do not expose the development bootstrap flow or start accepting live transactions until operational controls, tax treatment, backups/restores, monitoring, and the remaining modules have been completed and reviewed. No production URL is claimed.
