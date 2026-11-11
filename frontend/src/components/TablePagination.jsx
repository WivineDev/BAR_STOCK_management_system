export default function TablePagination({ page, meta, onPageChange, limit, onLimitChange }) {
  if (!meta?.totalRecords) return null;

  const currentPage = meta.page || page;
  const totalPages = meta.totalPages || 1;
  const firstRecord = (currentPage - 1) * (meta.limit || limit) + 1;
  const lastRecord = Math.min(currentPage * (meta.limit || limit), meta.totalRecords);

  return <div className="table-pagination">
    <span className="result-count">Showing {firstRecord}–{lastRecord} of {meta.totalRecords}</span>
    {onLimitChange && <label>Rows<select aria-label="Rows per page" value={limit} onChange={(event) => onLimitChange(Number(event.target.value))}><option value={5}>5</option><option value={10}>10</option><option value={25}>25</option><option value={50}>50</option></select></label>}
    <button type="button" className="button button-quiet" disabled={currentPage <= 1} onClick={() => onPageChange(Math.max(1, currentPage - 1))}>Previous</button>
    <span>Page {currentPage} of {totalPages}</span>
    <button type="button" className="button button-quiet" disabled={currentPage >= totalPages} onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}>Next</button>
  </div>;
}
