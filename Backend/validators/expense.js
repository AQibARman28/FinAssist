const { z } = require('zod');
const { objectId } = require('./common');

const isoDate = z.string().datetime({ offset: true }).or(z.string().date());

// Part 3: category is now an ObjectId reference to a user-owned Category
// (was a String enum; auto-categorization removed — categorization is an
// explicit user choice). `objectId` is the 24-hex-char regex from
// validators/common.js. The categoryGuard helper in utils/categoryGuard.js
// runs the existence + ownership + archive + type-compatibility check
// AFTER zod accepts the shape.
const create = z
    .object({
        amount:      z.number().nonnegative().max(1e12),
        category:    objectId,
        description: z.string().min(1).max(500),
        date:        isoDate.optional(),
        note:        z.string().max(2000).optional(),
    })
    .strict();

const update = z
    .object({
        amount:      z.number().nonnegative().max(1e12).optional(),
        category:    objectId.optional(),
        description: z.string().min(1).max(500).optional(),
        date:        isoDate.optional(),
        note:        z.union([z.string().max(2000), z.null(), z.literal('')]).optional(),
    })
    .strict()
    .refine((d) => Object.keys(d).length > 0, 'At least one field must be provided');

const list = z
    .object({
        page:      z.coerce.number().int().min(1).max(10_000).optional(),
        limit:     z.coerce.number().int().min(1).max(100).optional(),
        category:  objectId.optional(),
        startDate: isoDate.optional(),
        endDate:   isoDate.optional(),
    })
    .strict();

const summaryParams = z
    .object({
        year:  z.coerce.number().int().min(2000).max(2100),
        month: z.coerce.number().int().min(1).max(12),
    })
    .strict();

module.exports = { create, update, list, summaryParams };
