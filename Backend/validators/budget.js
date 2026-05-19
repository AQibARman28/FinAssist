const { z } = require('zod');
const { expenseCategoryEnum } = require('./common');

const year  = z.coerce.number().int().min(2020).max(2100);
const month = z.coerce.number().int().min(1).max(12);

const create = z
    .object({
        category:       expenseCategoryEnum,
        limit:          z.number().nonnegative().max(1e12),
        month:          z.number().int().min(1).max(12),
        year:           z.number().int().min(2020).max(2100),
        alertThreshold: z.number().int().min(0).max(100).optional(),
    })
    .strict();

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
        category: expenseCategoryEnum.optional(),
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
