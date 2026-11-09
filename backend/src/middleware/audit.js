import { randomUUID } from 'node:crypto';

export async function writeAudit(connection, { businessId, branchId = null, userId, action, module, recordId = null, reference = null, details = null }) {
  await connection.execute(
    `INSERT INTO audit_logs (id, business_id, branch_id, user_id, action, module, record_id, transaction_reference, details)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [randomUUID(), businessId, branchId, userId, action, module, recordId, reference, details ? JSON.stringify(details) : null],
  );
}
