/**
 * Category — user-owned tagging dimension for expenses (and, in Part 5, income).
 *
 * Shape constraints fixed by the Part-1 brief:
 *   - { user, name, type } is unique. A user cannot have two "Food" expense
 *     categories, but they CAN have a "Food" expense and a "Food" income
 *     (different types are independent).
 *   - `type` is set at creation and never modified afterward. Defense in
 *     depth: validator rejects the field in update schemas, and the model
 *     marks the path `immutable: true` (caught on .save(); findOneAndUpdate
 *     bypasses immutable so validator is the load-bearing check).
 *   - Soft-delete via `isArchived`. Hard delete only when no expense/income
 *     references exist (Part 2/5 will populate those refs).
 */

const mongoose = require('mongoose');

const ICONS = Object.freeze([
    'cart', 'car', 'home', 'heart', 'book', 'gift', 'briefcase',
    'wallet', 'star', 'utensils', 'phone', 'plane', 'more',
]);

const TYPES = Object.freeze(['expense', 'income', 'both']);

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

const categorySchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    name: { type: String, required: [true, 'Name is required'], trim: true, maxlength: [60, 'Name too long'] },

    type: {
        type:      String,
        required:  [true, 'Type is required'],
        enum:      TYPES,
        immutable: true,
    },

    color: {
        type:     String,
        required: [true, 'Color is required'],
        validate: {
            validator: (v) => HEX_COLOR.test(v),
            message:   'color must be a 6-digit hex string (e.g. #aabbcc)',
        },
    },

    icon: { type: String, required: [true, 'Icon is required'], enum: ICONS },

    isArchived: { type: Boolean, default: false },
    sortOrder:  { type: Number,  default: 0 },
}, { timestamps: true });

// Compound unique — same user can't reuse (name, type), but two users can
// each have their own "Food".
categorySchema.index({ user: 1, name: 1, type: 1 }, { unique: true });

// Common-case list query path: "give me this user's active expense
// categories in display order".
categorySchema.index({ user: 1, type: 1, isArchived: 1, sortOrder: 1 });

const Category = mongoose.model('Category', categorySchema);
Category.ICONS = ICONS;
Category.TYPES = TYPES;
module.exports = Category;
