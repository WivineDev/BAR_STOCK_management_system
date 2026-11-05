export function fail(status, message) { throw Object.assign(new Error(message), { status }); }

export function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}
