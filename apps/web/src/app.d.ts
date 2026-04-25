/// <reference types="@sveltejs/adapter-cloudflare" />

declare global {
  namespace App {
    interface Locals {
      user: import('@cmail/shared/types').User | null;
      sessionId: string | null;
    }
    interface Platform {
      env: import('@cmail/shared/types').Env;
      context: ExecutionContext;
    }
  }
}

export {};
