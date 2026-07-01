const fs = require('fs');
const env = fs.readFileSync('backend/.env', 'utf8');
const match = env.match(/DATABASE_URL="mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/([^\"]+)"/);
if (!match) {
  throw new Error('DATABASE_URL parse failed');
}
const [, user, password, host, port, database] = match;
const mysql = require('mysql2/promise');

(async () => {
  const conn = await mysql.createConnection({
    host,
    port: Number(port),
    user,
    password,
    database,
  });

  const [rows] = await conn.query(`
    SELECT
      base_org_id AS baseOrgId,
      base_org_name AS baseOrgName,
      record_date AS recordDate,
      loss_within_30_days AS lossWithin30Days,
      loss_yesterday AS lossYesterday,
      total_loss_count AS totalLossCount,
      raw_row_count AS rawRowCount,
      JSON_LENGTH(loss_detail) AS lossDetailDays,
      JSON_LENGTH(loss_operator_detail) AS lossOperatorDetailDays
    FROM anchor_loss_daily_summaries
    ORDER BY record_date DESC
    LIMIT 20
  `);

  console.log(JSON.stringify(rows, null, 2));
  await conn.end();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
