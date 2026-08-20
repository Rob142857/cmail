import { describe, expect, it, vi } from 'vitest';
import { submitSignOut } from './sign-out';

function fakeForm() {
  const submit = vi.fn();
  return { form: { submit } as unknown as HTMLFormElement, submit };
}

describe('submitSignOut', () => {
  it('posts the form after notification cleanup finishes', async () => {
    const { form, submit } = fakeForm();
    const order: string[] = [];
    const stop = vi.fn(async () => { order.push('stop'); });
    submit.mockImplementation(() => order.push('submit'));

    await submitSignOut(form, stop);

    expect(stop).toHaveBeenCalledOnce();
    expect(order).toEqual(['stop', 'submit']);
  });

  it('still posts the form when notification cleanup rejects', async () => {
    const { form, submit } = fakeForm();

    await submitSignOut(form, () => Promise.reject(new Error('IndexedDB blocked')));

    expect(submit).toHaveBeenCalledOnce();
  });

  it('keeps its own reference to the form across the await', async () => {
    // Regression: the handlers used to read event.currentTarget after awaiting,
    // which is null once dispatch ends, so sign-out silently never posted.
    const { form, submit } = fakeForm();
    let resolveStop = () => {};
    const pending = submitSignOut(form, () => new Promise<void>((resolve) => { resolveStop = resolve; }));

    expect(submit).not.toHaveBeenCalled();
    resolveStop();
    await pending;

    expect(submit).toHaveBeenCalledOnce();
  });
});
