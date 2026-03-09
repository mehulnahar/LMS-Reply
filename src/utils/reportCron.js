/**
 * Morning Report Cron
 *
 * Fires at 7:00 AM IST daily = 01:30 UTC
 * Cron: 30 1 * * *
 *
 * Fetches all users with a whatsapp_config entry and sends report
 */

const cron = require('node-cron');
const pool = require('../config/db');
const { sendMessage, getStatus } = require('./whatsapp');
const { generateMorningReport } = require('./morningReport');

let cronJob = null;

async function runMorningReport() {
  console.log('[ReportCron] Running morning report...');
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
        const report = await generateMorningReport(config.user_id);
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
