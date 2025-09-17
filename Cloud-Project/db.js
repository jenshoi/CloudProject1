const mariadb = require('mariadb');

const pool = mariadb.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'user',
  password: process.env.DB_PASSWORD || 'pass',
  database: process.env.DB_NAME || 'videosdb',
  connectionLimit: 5,
});

// Init logic without messing with exports
(async () => {
  let conn; //hva er logikken med conn? hva betyr syntaksen her?!!!!!!
  try {
    conn = await pool.getConnection();
    console.log('Connection successful.');
    await conn.query(`    
        CREATE TABLE IF NOT EXISTS videos (
          id VARCHAR(64) PRIMARY KEY,
          filename VARCHAR(255) NOT NULL,
          status ENUM('running','done','error') NOT NULL DEFAULT 'running',
          count INT NULL,
          input_path VARCHAR(512) NOT NULL,
          output_path VARCHAR(512) NOT NULL,
          metadata_path VARCHAR(512) NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        );
      `);
      //sql tabell opprettes med de ulike attributtene, her kan man utvide dersom ønskelig
    await conn.query(`
        ALTER TABLE videos
        ADD COLUMN IF NOT EXISTS owner VARCHAR(64) NULL;
      `);

  } catch (err) {
    console.error('DB init failed:', err.message);
  } finally {
    if (conn) {
      conn.release();
      console.log('Releasing connection...');
    }
  }
})();

module.exports = pool;