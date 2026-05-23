const { z } = require('zod');
const { objectId } = require('./common');

// Accepts a full ISO datetime (with offset) or a bare YYYY-MM-DD date.
const isoDate = z.string().datetime({ offset: true }).or(z.string().date());

// GET /api/analytics/spending-timeline query.
// Shared primitive for the DASH-1 spending curve and (later) EXP-1 Phase 5.
const spendingTimeline = z
    .object({
        granularity:  z.enum(['daily', 'weekly', 'monthly', 'yearly']),
        from:         isoDate.optional(),
        to:           isoDate.optional(),
        category:     objectId.optional(),
        previewLimit: z.coerce.number().int().min(1).max(50).optional(),
    })
    .strict();

module.exports = { spendingTimeline };
