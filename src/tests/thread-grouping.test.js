/**
 * Thread Grouping — Unit Tests
 *
 * Tests the thread-wide job lookup fallback logic:
 * 1. Direct email-job match → use it (no fallback)
 * 2. No direct match, thread sibling has match → use sibling's job
 * 3. No direct match, no thread match → null
 * 4. No thread_id on email → no fallback attempted
 * 5. Single-message thread → behaves identically to current
 */

const { findJobForEmail } = require('../utils/threadJobLookup');

// Mock pool factory — returns a pool whose .query() resolves based on the SQL
function createMockPool(responses) {
  return {
    query: jest.fn((sql, params) => {
      for (const [pattern, result] of responses) {
        if (sql.includes(pattern)) {
          return Promise.resolve({ rows: typeof result === 'function' ? result(params) : result });
        }
      }
      return Promise.resolve({ rows: [] });
    }),
  };
}

describe('findJobForEmail — thread-wide job lookup', () => {
  const userId = 1;

  test('direct match found → returns job without fallback', async () => {
    const directJob = { id: 10, email_id: 100, match_status: 'matched', job_heading: 'Web Dev' };
    const pool = createMockPool([
      ['WHERE email_id = $1 AND match_status', [directJob]],
    ]);
    const email = { id: 100, thread_id: 'thread_abc' };

    const result = await findJobForEmail(pool, email, userId);

    expect(result).toEqual(directJob);
    // Should only call the direct query, no fallback
    expect(pool.query).toHaveBeenCalledTimes(1);
    expect(pool.query.mock.calls[0][0]).toContain('WHERE email_id = $1');
  });

  test('no direct match, thread sibling has match → returns sibling job', async () => {
    const siblingJob = { id: 20, email_id: 101, match_status: 'matched', job_heading: 'App Dev' };
    const pool = createMockPool([
      ['WHERE email_id = $1 AND match_status', []],          // no direct match
      ['WHERE e.thread_id = $1 AND e.user_id', [siblingJob]], // thread fallback
    ]);
    const email = { id: 102, thread_id: 'thread_abc' };

    const result = await findJobForEmail(pool, email, userId);

    expect(result).toEqual(siblingJob);
    expect(pool.query).toHaveBeenCalledTimes(2);
  });

  test('no direct match, no thread match → returns null', async () => {
    const pool = createMockPool([
      ['WHERE email_id = $1 AND match_status', []], // no direct match
      ['WHERE e.thread_id = $1 AND e.user_id', []], // no thread match
    ]);
    const email = { id: 103, thread_id: 'thread_xyz' };

    const result = await findJobForEmail(pool, email, userId);

    expect(result).toBeNull();
    expect(pool.query).toHaveBeenCalledTimes(2);
  });

  test('email has no thread_id → skips fallback, returns null', async () => {
    const pool = createMockPool([
      ['WHERE email_id = $1 AND match_status', []], // no direct match
    ]);
    const email = { id: 104, thread_id: null };

    const result = await findJobForEmail(pool, email, userId);

    expect(result).toBeNull();
    // Should NOT attempt the thread-wide query
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  test('email has undefined thread_id → skips fallback, returns null', async () => {
    const pool = createMockPool([
      ['WHERE email_id = $1 AND match_status', []], // no direct match
    ]);
    const email = { id: 105 }; // no thread_id property

    const result = await findJobForEmail(pool, email, userId);

    expect(result).toBeNull();
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  test('direct match takes priority over thread match', async () => {
    const directJob = { id: 30, email_id: 200, match_status: 'matched', job_heading: 'Direct' };
    const siblingJob = { id: 31, email_id: 201, match_status: 'matched', job_heading: 'Sibling' };
    const pool = createMockPool([
      ['WHERE email_id = $1 AND match_status', [directJob]],
      ['WHERE e.thread_id = $1 AND e.user_id', [siblingJob]],
    ]);
    const email = { id: 200, thread_id: 'thread_priority' };

    const result = await findJobForEmail(pool, email, userId);

    expect(result).toEqual(directJob);
    expect(result.job_heading).toBe('Direct');
    // Should not reach the fallback query
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  test('passes correct parameters to queries', async () => {
    const pool = createMockPool([
      ['WHERE email_id = $1 AND match_status', []],
      ['WHERE e.thread_id = $1 AND e.user_id', []],
    ]);
    const email = { id: 42, thread_id: 'thread_params' };
    const testUserId = 7;

    await findJobForEmail(pool, email, testUserId);

    // Direct query params
    expect(pool.query.mock.calls[0][1]).toEqual([42]);
    // Thread fallback params
    expect(pool.query.mock.calls[1][1]).toEqual(['thread_params', 7]);
  });
});
