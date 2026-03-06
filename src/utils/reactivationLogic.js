'use strict';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Calculate reactivation result for a dormant lead.
 *
 * Pure function -- no DB or I/O. Injectable `now` for deterministic testing.
 *
 * @param {string|Date|null} killSwitchAt - When kill switch was triggered
 * @param {Date} [now=new Date()] - Current time (injectable for testing)
 * @returns {{ shouldFullReactivate: boolean, daysRemaining: number }}
 */
function calculateReactivation(killSwitchAt, now = new Date()) {
  if (!killSwitchAt) {
    return { shouldFullReactivate: true, daysRemaining: 0 };
  }
  const switchDate = new Date(killSwitchAt);
  if (isNaN(switchDate.getTime())) {
    // Invalid date -- treat as no kill switch (full reactivation)
    return { shouldFullReactivate: true, daysRemaining: 0 };
  }
  const elapsed = now.getTime() - switchDate.getTime();
  if (elapsed > THIRTY_DAYS_MS) {
    return { shouldFullReactivate: true, daysRemaining: 0 };
  }
  return {
    shouldFullReactivate: false,
    daysRemaining: Math.ceil((THIRTY_DAYS_MS - elapsed) / (24 * 60 * 60 * 1000)),
  };
}

module.exports = { calculateReactivation, THIRTY_DAYS_MS };
