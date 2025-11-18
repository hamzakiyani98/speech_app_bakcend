const mysql = require('mysql2/promise');
require('dotenv').config();

// Database configuration
const db = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'document_play_app',
  connectionLimit: 10,
  waitForConnections: true,
  queueLimit: 0
});

// Test database connection
async function testDatabase() {
  try {
    const connection = await db.getConnection();
    console.log('✅ Database connected');
    connection.release();
    return true;
  } catch (error) {
    console.error('❌ Database error:', error.message);
    return false;
  }
}

module.exports = { db, testDatabase };
