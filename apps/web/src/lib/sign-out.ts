import { stopPushBeforeSignOut } from './push-client';

/**
 * Stops notifications for this device, then posts the sign-out form.
 *
 * The caller must capture `form` synchronously, before the first `await`: an
 * event's `currentTarget` is null once dispatch has finished, so reading it
 * afterwards throws and the sign-out never posts. Cleanup failures are
 * swallowed for the same reason — nothing may stand between a person and
 * signing out.
 */
export async function submitSignOut(
  form: HTMLFormElement,
  stop: () => Promise<void> = stopPushBeforeSignOut,
): Promise<void> {
  try {
    await stop();
  } catch {
    // Signing out must never be blocked by notification cleanup.
  }
  form.submit();
}
