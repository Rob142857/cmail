// cmail backup Worker: scheduled only. It has no fetch handler, so nothing is
// reachable over HTTP; it runs on its cron trigger and logs counts only.
import { runBackup, type BackupEnv } from './backup';

export default {
  async scheduled(controller: ScheduledController, env: BackupEnv): Promise<void> {
    // A BackupRefused (wrong or shared bucket, mass disappearance) throws here,
    // so the run shows as failed in Cron Trigger history and nothing changed.
    const summary = await runBackup(env, new Date(controller.scheduledTime));
    console.log('cmail backup run', summary);
    if (summary.copyFailures > 0 || summary.databaseError || summary.deletionsPaused) {
      // Throwing marks the run as failed, so it shows in Cron history; the next run retries.
      throw new Error(`cmail backup: ${summary.copyFailures} copy failures, database ${summary.databaseError ?? 'ok'}, deletions ${summary.deletionsPaused ? `paused (${summary.deletionsPaused})` : 'ok'}`);
    }
  },
};
