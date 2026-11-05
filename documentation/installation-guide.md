# Local installation (Windows + XAMPP)

1. Install Node.js 20+ and XAMPP with MySQL/MariaDB.
2. Start MySQL in XAMPP. Create a fresh `bssbms` database using phpMyAdmin. The migration runner intentionally refuses to alter a non-empty database without this app's migration marker; if a `bssbms` database already exists, use a new local database name in `backend/.env` or plan a reviewed schema migration.
3. Copy `backend/.env.example` to `backend/.env`; set the XAMPP credentials and a random JWT secret of at least 32 characters. Never expose the `.env` file.
4. From the repository root, run `npm install`.
5. Run `npm run migrate -w backend` to create the schema. Alternatively, import `backend/database/bssbms.sql` through phpMyAdmin on the empty database; the SQL file marks its version, so do not import it into an existing business database.
6. Run `npm run dev` to launch the API at port 5000 and Vite at port 5173.
7. Open `http://localhost:5173` and choose “Set up the first owner”. Bootstrap is disabled after the first account exists.

Default XAMPP configurations commonly have an empty root password. Set `DB_PASSWORD` to the actual local value; configure a dedicated database user for any shared or hosted environment. If port 5000 is occupied, change both API `PORT` and frontend `VITE_API_URL` to the same free port.
