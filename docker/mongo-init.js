// Runs once, on the first start of an empty data volume (mongo image's
// /docker-entrypoint-initdb.d). Creates the least-privilege user the API
// connects as: readWrite on the finassist database only — not root.
const dbName = 'finassist';
db.getSiblingDB(dbName).createUser({
    user: process.env.MONGO_APP_USER,
    pwd:  process.env.MONGO_APP_PASSWORD,
    roles: [{ role: 'readWrite', db: dbName }],
});
