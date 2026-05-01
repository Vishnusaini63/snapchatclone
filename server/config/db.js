const mysql = require("mysql2");
require("dotenv").config();

const dbUrl = process.env.DATABASE_URL;

if (!dbUrl) {
  console.error("❌ DATABASE_URL missing");
  process.exit(1);
}

const db = mysql.createPool(dbUrl);

db.getConnection((err, conn) => {
  if (err) {
    console.log("❌ DB ERROR:", err);
  } else {
    console.log("✅ Railway DB Connected");
    conn.release();
  }
});

module.exports = db;  