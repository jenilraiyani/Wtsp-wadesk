const fs = require('fs');
const path = require('path');
const { getPool } = require('../lib/db');

const runSqlFile = async (pool, filePath) => {
    const raw = fs.readFileSync(filePath, 'utf8')
        .replace(/^\s*USE\s+\S+\s*;?\s*$/gim, '')
        .replace(/^\s*GO\s*$/gim, ';;;BATCH;;;');

    const batches = raw.split(';;;BATCH;;;').map((part) => part.trim()).filter(Boolean);
    for (const batch of batches) {
        await pool.request().query(batch);
    }
};

const start = async () => {
    const pool = await getPool();
    await pool.request().query('SET QUOTED_IDENTIFIER ON');
    await runSqlFile(pool, path.join(__dirname, 'schema.sql'));
    await runSqlFile(pool, path.join(__dirname, 'auth-email-google.sql'));
    await runSqlFile(pool, path.join(__dirname, 'automation.sql'));
    await runSqlFile(pool, path.join(__dirname, 'templates.sql'));
    await runSqlFile(pool, path.join(__dirname, 'contacts.sql'));

    const tables = await pool.request().query(`
        SELECT TABLE_NAME
        FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_TYPE = 'BASE TABLE' AND TABLE_SCHEMA = 'dbo'
        ORDER BY TABLE_NAME
    `);
    console.log('Tables:', tables.recordset.map((row) => row.TABLE_NAME).join(', '));
    process.exit(0);
};

start().catch((error) => {
    console.error('Database setup failed:', error.message);
    process.exit(1);
});
