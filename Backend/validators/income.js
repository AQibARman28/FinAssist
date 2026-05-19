const { z } = require('zod');
const { objectId } = require('./common');

const isoDate = z.string().datetime({ offset: true }).or(z.string().date());
const recurringFrequency = z.enum(['weekly', 'biweekly', 'monthly', 'yearly']);

// Cross-field refine: if isRecurring is true, recurringFrequency MUST be
// provided. Applied to both create and update so a client cannot set
// isRecurring on an existing record without picking a cadence.
const recurringRefine = (d) => !d.isRecurring || !!d.recurringFrequency;
const recurringRefineErr = {
    message: 'recurringFrequency is required when isRecurring is true',
    path:    ['recurringFrequency'],
};

const create = z
    .object({
        amount:             z.number().nonnegative().max(1e12),
        category:           objectId,
        description:        z.string().min(1).max(500),
        date:               isoDate,
        isRecurring:        z.boolean().optional(),
        recurringFrequency: recurringFrequency.optional(),
        isPostTax:          z.boolean().optional(),
        note:               z.string().max(2000).optional(),
    })
    .strict()
    .refine(recurringRefine, recurringRefineErr);

const update = z
    .object({
        amount:             z.number().nonnegative().max(1e12).optional(),
        category:           objectId.optional(),
        description:        z.string().min(1).max(500).optional(),
        date:               isoDate.optional(),
        isRecurring:        z.boolean().optional(),
        recurringFrequency: recurringFrequency.optional(),
        isPostTax:          z.boolean().optional(),
        note:               z.union([z.string().max(2000), z.null(), z.literal('')]).optional(),
    })
    .strict()
    .refine((d) => Object.keys(d).length > 0, 'At least one field must be provided')
    .refine(recurringRefine, recurringRefineErr);

const list = z
    .object({
        page:      z.coerce.number().int().min(1).max(10_000).optional(),
        limit:     z.coerce.number().int().min(1).max(100).optional(),
        category:  objectId.optional(),
        startDate: isoDate.optional(),
        endDate:   isoDate.optional(),
    })
    .strict();

module.exports = { create, update, list };
