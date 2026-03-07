/**
 * Thread-wide job lookup — finds a matched job for an email,
 * falling back to sibling emails in the same Gmail thread.
 *
 * @param {object} pool - PostgreSQL pool
 * @param {object} email - Email row with { id, thread_id }
 * @param {number} userId - Authenticated user ID
 * @returns {Promise<object|null>} Matched job row or null
 */
async function findJobForEmail(pool, email, userId) {
  // 1. Direct match: job linked to this specific email
  let { rows: jobRows } = await pool.query(
    "SELECT * FROM jobs WHERE email_id = $1 AND match_status = 'matched'",
    [email.id]
  );

  // 2. Thread-wide fallback: check sibling emails in same thread
  if (jobRows.length === 0 && email.thread_id) {
    const { rows: threadJobRows } = await pool.query(
      `SELECT j.* FROM jobs j
       JOIN emails e ON j.email_id = e.id
       WHERE e.thread_id = $1 AND e.user_id = $2 AND j.match_status = 'matched'
       ORDER BY j.matched_at DESC LIMIT 1`,
      [email.thread_id, userId]
    );
    if (threadJobRows.length > 0) jobRows = threadJobRows;
  }

  return jobRows.length > 0 ? jobRows[0] : null;
}

module.exports = { findJobForEmail };
