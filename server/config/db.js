const mysql = require("mysql2");
require("dotenv").config();

const dbUrl = process.env.DATABASE_URL;

if (!dbUrl) {
  console.error("❌ DATABASE_URL missing");
  process.exit(1);
}

const db = mysql.createPool({
  uri: dbUrl,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Test connection
db.getConnection((err, conn) => {
  if (err) {
    console.log("❌ DB ERROR:", err.message);
  } else {
    console.log("✅ Railway DB Connected");
    conn.release();
  }
});

module.exports = db;