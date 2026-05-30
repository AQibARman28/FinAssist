const { z } = require('zod');
const { goalTypeEnum, goalStatusEnum, objectId } = require('./common');

const isoDate = z.string().datetime({ offset: true }).or(z.string().date());
const priority = z.number().int().min(0).max(1000);
const periodEnum = z.enum(['monthly', 'yearly']);

const create = z
    .object({
        title:        z.string().min(1).max(120),
        description:  z.string().max(2000).optional(),
        targetAmount: z.number().positive().max(1e12),
        period:       periodEnum.default('monthly'),
        // Optional now — the period-based UI derives the deadline and defaults
        // the type. Still accepted for callers that supply them.
        targetDate:   isoDate.optional(),
        goalType:     goalTypeEnum.optional(),
        priority:     priority.optional(),
        note:         z.string().max(2000).optional(),
    })
    .strict();

const update = z
    .object({
        title:        z.string().min(1).max(120).optional(),
        description:  z.union([z.string().max(2000), z.null()]).optional(),
        targetAmount: z.number().positive().max(1e12).optional(),
        targetDate:   isoDate.optional(),
        goalType:     goalTypeEnum.optional(),
        period:       periodEnum.optional(),
        status:       goalStatusEnum.optional(),
        priority:     priority.optional(),
        note:         z.union([z.string().max(2000), z.null(), z.literal('')]).optional(),
    })
    .strict()
    .refine((d) => Object.keys(d).length > 0, 'At least one field must be provided');

// POST /api/goals/allocate — user-confirmed surplus deployment.
const allocate = z
    .object({
        allocations: z.array(z.object({ goalId: objectId, amount: z.number().positive().max(1e12) }).strict()).min(1),
        date:        isoDate.optional(),
        note:        z.string().max(500).optional(),
    })
    .strict();

const list = z
    .object({
        status:   goalStatusEnum.optional(),
        goalType: goalTypeEnum.optional(),
        period:   periodEnum.optional(),
    })
    .strict();

const contribute = z
    .object({
        amount: z.number().positive().max(1e12),
        note:   z.string().max(500).optional(),
    })
    .strict();

module.exports = { create, update, list, contribute, allocate };
