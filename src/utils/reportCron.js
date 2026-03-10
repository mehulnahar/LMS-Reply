/**
 * Morning Report Cron
 *
 * Flow:
 * 1. 7:00 AM IST (01:30 UTC) - sync all Gmail accounts first
 * 2. Then generate morning report with fresh data
 * 3. Send via WhatsApp
 *
 * Fetches all users with a whatsapp_config entry and sends report
 */

const cron = require('node-cron');
const pool = require('../config/db');
const { sendMessage, getStatus } = require('./whatsapp');
const { generateMorningReport } = require('./morningReport');
const { syncAllAccounts } = require('./emailSync');
const { matchAllUnmatched } = require('./jobMatcher');

let cronJob = null;

async function runMorningReport() {
  console.log('[ReportCron] Starting morning report pipeline...');
  try {
    const { rows: configs } = await pool.query(
      'SELECT user_id, phone_number FROM whatsapp_config WHERE is_active = true'
    );

    if (!configs.length) {
      console.log('[ReportCron] No active WhatsApp configs found');
      return;
    }

    for (const config of configs) {
      try {
        // Step 1: Sync all email accounts to get fresh data
        console.log(`[ReportCron] Syncing emails for user ${config.user_id}...`);
        const syncResult = await syncAllAccounts(config.user_id);
        const totalSynced = syncResult.results.reduce((sum, r) => sum + (r.synced || 0), 0);
        console.log(`[ReportCron] Sync complete: ${totalSynced} new emails across ${syncResult.results.length} accounts`);

        // Step 1b: Auto-match unmatched emails to LeadHack jobs
        try {
          const matchResult = await matchAllUnmatched(config.user_id);
          console.log(`[ReportCron] Job matching: ${matchResult.matched} matched, ${matchResult.noMatch} no match, ${matchResult.failed} failed out of ${matchResult.total} unmatched`);
        } catch (matchErr) {
          console.error(`[ReportCron] Job matching failed:`, matchErr.message);
        }

        // Step 2: Generate report with fresh data
        const report = await generateMorningReport(config.user_id);

        // Step 3: Send via WhatsApp
        if (getStatus() !== 'ready') {
          console.error('[ReportCron] WhatsApp not ready, skipping send');
          return;
        }
        await sendMessage(config.phone_number, report);
        console.log(`[ReportCron] Report sent to ${config.phone_number}`);
      } catch (e) {
        console.error(`[ReportCron] Failed for user ${config.user_id}:`, e.message);
      }
    }
  } catch (e) {
    console.error('[ReportCron] Fatal error:', e.message);
  }
}

function startCron() {
  if (cronJob) return;

  // 7AM IST = 01:30 UTC  - cron: minute hour * * *
  cronJob = cron.schedule('30 1 * * *', runMorningReport, {
    timezone: 'UTC',
  });

  console.log('[ReportCron] Scheduled - fires at 7:00 AM IST (01:30 UTC) daily');
}

function stopCron() {
  if (cronJob) {
    cronJob.destroy();
    cronJob = null;
    console.log('[ReportCron] Stopped');
  }
}

module.exports = { startCron, stopCron, runMorningReport };
