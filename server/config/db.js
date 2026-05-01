const mysql = require("mysql2");
require("dotenv").config();

const db = mysql.createPool(process.env.DATABASE_URL);

db.getConnection((err, conn) => {
  if (err) {
    console.log("❌ DB ERROR:", err);
  } else {
    console.log("✅ Railway DB Connected");
    conn.release();
  }
});

module.exports = db;