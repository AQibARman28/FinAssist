const { z } = require('zod');

const amount = z.number().positive().max(1e12);

const deposit = z
    .object({ amount, note: z.string().max(500).optional() })
    .strict();

const withdraw = z
    .object({ amount, note: z.string().max(500).optional() })
    .strict();

const rollover = z
    .object({ action: z.enum(['carry', 'save']) })
    .strict();

module.exports = { deposit, withdraw, rollover };
