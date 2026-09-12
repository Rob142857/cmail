import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { configuredPushHosts } from './push.ts';

describe('configuredPushHosts', () => {
  it('trims boundary dots without a backtracking regular expression', () => {
    assert.deepEqual(
      configuredPushHosts({ PUSH_ENDPOINT_HOSTS: '...push.example.test..., ..invalid..' }),
      ['fcm.googleapis.com', 'push.services.mozilla.com', 'push.apple.com', 'notify.windows.com', 'push.example.test'],
    );
  });
});
