/**
 * G7 — every Expense query filters on { user, date } (lists, summaries,
 * analytics, balance, budgets), so the collection needs a compound
 * { user: 1, date: -1 } index. The single-field category index stays.
 */
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const Expense = require('../models/Expense');

const keyOf = (spec) => JSON.stringify(spec);

describe('Expense indexes (schema)', () => {
    test('declares a compound { user: 1, date: -1 } index', () => {
        const specs = Expense.schema.indexes().map(([fields]) => keyOf(fields));
        expect(specs).toContain(keyOf({ user: 1, date: -1 }));
    });

    test('keeps the category index', () => {
        const specs = Expense.schema.indexes().map(([fields]) => keyOf(fields));
        expect(specs).toContain(keyOf({ category: 1 }));
    });
});

describe('Expense indexes (built in Mongo)', () => {
    let mongo;
    beforeAll(async () => {
        mongo = await MongoMemoryServer.create();
        await mongoose.connect(mongo.getUri());
        await Expense.init();
    }, 60_000);
    afterAll(async () => {
        await mongoose.disconnect();
        if (mongo) await mongo.stop();
    });

    test('listIndexes() reports user_1_date_-1 and category_1', async () => {
        const names = (await Expense.listIndexes()).map((i) => i.name);
        expect(names).toEqual(expect.arrayContaining(['user_1_date_-1', 'category_1']));
    });
});
