require('dotenv').config();
const fs = require('fs').promises;
const mysql = require('mysql2/promise');

(async () => {
  try {
    const sql = await fs.readFile(__dirname + '/init_db.sql', 'utf8');
    const connection = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 3306,
      multipleStatements: true
    });

    await connection.query(sql);
    console.log('Database initialized successfully.');
    await connection.end();
  } catch (err) {
    console.error('Failed to initialize database:', err.message);
    process.exit(1);
  }
})();
