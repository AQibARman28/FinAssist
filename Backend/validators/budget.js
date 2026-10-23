const { z } = require('zod');
const { objectId } = require('./common');

const year  = z.coerce.number().int().min(2020).max(2100);
const month = z.coerce.number().int().min(1).max(12);

// G1: category is the id of one of the user's Category rows (type expense or
// both) — the same id an Expense stores. The controller runs
// utils/categoryGuard for existence / ownership / archive / type.
const create = z
    .object({
        category:       objectId,
        limit:          z.number().nonnegative().max(1e12),
        month:          z.number().int().min(1).max(12),
        year:           z.number().int().min(2020).max(2100),
        alertThreshold: z.number().int().min(0).max(100).optional(),
    })
    .strict();

// Category is deliberately not editable: the budget row IS the
// (category, month, year) slot. Delete + re-create to move a limit.
const update = z
    .object({
        limit:          z.number().nonnegative().max(1e12).optional(),
        alertThreshold: z.number().int().min(0).max(100).optional(),
        isActive:       z.boolean().optional(),
    })
    .strict()
    .refine((d) => Object.keys(d).length > 0, 'At least one field must be provided');

const list = z
    .object({
        month:    month.optional(),
        year:     year.optional(),
        category: objectId.optional(),
    })
    .strict();

const trackingParams = z.object({ year, month }).strict();

const reset = z
    .object({
        fromMonth: z.number().int().min(1).max(12),
        fromYear:  z.number().int().min(2020).max(2100),
        toMonth:   z.number().int().min(1).max(12),
        toYear:    z.number().int().min(2020).max(2100),
    })
    .strict();

module.exports = { create, update, list, trackingParams, reset };
