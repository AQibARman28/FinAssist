/**
 * Validators for the Category routes. Mirrors the model's constraints with
 * zod `.strict()` everywhere so:
 *   - Unknown body keys → 400 (mass-assignment closed).
 *   - `type` cannot be supplied on update (the only place the field
 *     immutability is actually enforced — Mongoose `immutable: true` is
 *     bypassed by findOneAndUpdate).
 */

const { z } = require('zod');

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

const ICONS = [
    'cart', 'car', 'home', 'heart', 'book', 'gift', 'briefcase',
    'wallet', 'star', 'utensils', 'phone', 'plane', 'more',
];

const typeEnum = z.enum(['expense', 'income', 'both']);
const iconEnum = z.enum(ICONS);
const color    = z.string().regex(HEX_COLOR, 'color must be a 6-digit hex like #aabbcc');
const name     = z.string().trim().min(1, 'name is required').max(60, 'name too long');
const sortOrder = z.number().int().min(0).max(10_000);

// Coerce "true"/"false" query params (always strings) to booleans without
// silently accepting other truthy values.
const queryBool = z.union([z.literal('true'), z.literal('false')]);

const create = z.object({
    name,
    type:      typeEnum,
    color,
    icon:      iconEnum,
    sortOrder: sortOrder.optional(),
}).strict();

// Note: NO `type` key. Trying to send `type` from a client returns 400
// "Unrecognized key: type" from zod.
const update = z.object({
    name:       name.optional(),
    color:      color.optional(),
    icon:       iconEnum.optional(),
    isArchived: z.boolean().optional(),
    sortOrder:  sortOrder.optional(),
}).strict().refine((d) => Object.keys(d).length > 0, 'At least one field must be provided');

const list = z.object({
    type:            typeEnum.optional(),
    includeArchived: queryBool.optional(),
}).strict();

const deleteQuery = z.object({
    force: queryBool.optional(),
}).strict();

module.exports = { create, update, list, deleteQuery, ICONS };
