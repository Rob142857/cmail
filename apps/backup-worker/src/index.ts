// cmail backup Worker: scheduled only. It has no fetch handler, so nothing is
// reachable over HTTP; it runs on its cron trigger and logs counts only.
import { runBackup, type BackupEnv } from './backup';

export default {
  async scheduled(controller: ScheduledController, env: BackupEnv): Promise<void> {
    const summary = await runBackup(env, new Date(controller.scheduledTime));
    console.log('cmail backup run', summary);
    if (summary.copyFailures > 0) {
      // Throwing marks the run as failed in Cron Trigger history; the next run retries.
      throw new Error(`cmail backup: ${summary.copyFailures} object copies failed`);
    }
  },
};
