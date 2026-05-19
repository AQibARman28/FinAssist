const { z } = require('zod');
const { goalTypeEnum, goalStatusEnum } = require('./common');

const isoDate = z.string().datetime({ offset: true }).or(z.string().date());

const create = z
    .object({
        title:        z.string().min(1).max(120),
        description:  z.string().max(2000).optional(),
        targetAmount: z.number().positive().max(1e12),
        targetDate:   isoDate,
        goalType:     goalTypeEnum,
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
        status:       goalStatusEnum.optional(),
        note:         z.union([z.string().max(2000), z.null(), z.literal('')]).optional(),
    })
    .strict()
    .refine((d) => Object.keys(d).length > 0, 'At least one field must be provided');

const list = z
    .object({
        status:   goalStatusEnum.optional(),
        goalType: goalTypeEnum.optional(),
    })
    .strict();

const contribute = z
    .object({
        amount: z.number().positive().max(1e12),
        note:   z.string().max(500).optional(),
    })
    .strict();

module.exports = { create, update, list, contribute };
