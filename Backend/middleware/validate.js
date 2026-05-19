/**
 * validate({ body?, params?, query? }) — generic zod validation middleware.
 *
 * Each part-schema runs in order; the first failure returns 400 with a flat
 * { field: message } map. Validated values overwrite the corresponding
 * `req.body/params/query` so downstream code only ever sees the cleaned
 * shape. Unknown fields are rejected (each schema is expected to be `.strict()`).
 *
 * Phase 4 (SEC-1): rejects NoSQL-injection-style payloads at the boundary —
 * z.string() refuses object inputs, so `{email: {"$gt": ""}}` lands as a 400
 * instead of flowing into a Mongo query.
 */

function _formatIssues(error) {
    const out = {};
    for (const issue of error.issues || []) {
        const path = issue.path.length ? issue.path.join('.') : '_';
        if (!out[path]) out[path] = issue.message;
    }
    return out;
}

function validate(parts) {
    return (req, res, next) => {
        for (const key of ['body', 'params', 'query']) {
            const schema = parts[key];
            if (!schema) continue;
            const result = schema.safeParse(req[key]);
            if (!result.success) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid request',
                    errors:  _formatIssues(result.error),
                    in:      key,
                });
            }
            // Some Express handlers expect req.query/req.params to be plain
            // objects; zod returns parsed objects so this assignment is safe.
            // Note: req.query is a getter in newer Express versions — fall
            // back to defineProperty if direct assignment fails.
            try {
                req[key] = result.data;
            } catch {
                Object.defineProperty(req, key, { value: result.data, writable: true });
            }
        }
        next();
    };
}

module.exports = { validate };
