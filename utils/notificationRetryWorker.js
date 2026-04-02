const { retryDueNotifications } = require('./notificationDispatcher');

let timer = null;
let running = false;

const processBatch = async ({ batchSize }) => {
  if (running) return;
  running = true;
  try {
    const processed = await retryDueNotifications({ limit: batchSize });
    if (processed.length) {
      // eslint-disable-next-line no-console
      console.log(`[notifications] retry worker processed ${processed.length} notification(s)`);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[notifications] retry worker failed:', err?.message || err);
  } finally {
    running = false;
  }
};

const startNotificationRetryWorker = () => {
  if (String(process.env.NOTIFICATION_RETRY_WORKER_ENABLED || 'true').toLowerCase() === 'false') {
    return null;
  }

  const intervalMs = Math.max(15000, Number(process.env.NOTIFICATION_RETRY_INTERVAL_MS || 60000));
  const batchSize = Math.max(1, Math.min(100, Number(process.env.NOTIFICATION_RETRY_BATCH_SIZE || 20)));

  if (timer) clearInterval(timer);
  timer = setInterval(() => {
    processBatch({ batchSize });
  }, intervalMs);

  if (typeof timer.unref === 'function') timer.unref();
  void processBatch({ batchSize });
  return timer;
};

const stopNotificationRetryWorker = () => {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
};

module.exports = {
  startNotificationRetryWorker,
  stopNotificationRetryWorker,
};
