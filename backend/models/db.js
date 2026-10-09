const { config } = require('../config');

let poolPromise = null;

const getSql = () => {
    if (config.mssql.driver === 'msnodesqlv8') {
        return require('mssql/msnodesqlv8');
    }
    return require('mssql');
};

const buildConnectionString = () => {
    const driverName = process.env.MSSQL_ODBC_DRIVER || 'ODBC Driver 18 for SQL Server';
    const parts = [
        `Driver={${driverName}}`,
        `Server=${config.mssql.server}`,
        `Database=${config.mssql.database}`,
        'TrustServerCertificate=Yes'
    ];

    if (config.mssql.user) {
        parts.push('Trusted_Connection=No');
        parts.push(`Uid=${config.mssql.user}`);
        parts.push(`Pwd=${config.mssql.password}`);
    } else {
        parts.push('Trusted_Connection=Yes');
    }

    return parts.join(';');
};

const getPool = async () => {
    if (poolPromise) return poolPromise;

    const sql = getSql();
    const connectionString = buildConnectionString();
    const poolConfig = {
        connectionString,
        options: {
            trustedConnection: !config.mssql.user,
            trustServerCertificate: true,
            encrypt: true
        },
        pool: {
            max: 10,
            min: 0,
            idleTimeoutMillis: 30000
        }
    };

    poolPromise = new sql.ConnectionPool(poolConfig).connect()
        .then((pool) => {
            const auth = config.mssql.user ? config.mssql.user : 'Windows';
            console.log(`MSSQL connected: ${config.mssql.server}/${config.mssql.database} (${auth})`);
            return pool;
        })
        .catch((error) => {
            poolPromise = null;
            throw error;
        });

    return poolPromise;
};

const query = async (text, params = {}) => {
    const pool = await getPool();
    const request = pool.request();
    for (const [key, value] of Object.entries(params)) {
        request.input(key, value);
    }
    return request.query(text);
};

module.exports = { getPool, query, buildConnectionString };
