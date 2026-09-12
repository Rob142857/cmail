/**
 * Keep database/provider details in server logs only. Loader return values are
 * serialized into the browser, including for an authenticated manager, so a
 * raw D1 message would disclose schema and query details to the client.
 */
export function adminLoaderFailure(scope: string, cause: unknown): {
  error: string;
  errorReference: string;
} {
  const errorReference = crypto.randomUUID();
  console.error(`Admin ${scope} loader failed`, {
    errorReference,
    errorType: cause instanceof Error ? cause.name : 'UnknownError',
    // Preserve the actionable D1 diagnostic on the server. Logging only the
    // type would make the support reference impossible to investigate.
    message: cause instanceof Error ? cause.message.slice(0, 2000) : 'Non-Error exception',
    cause: cause instanceof Error && cause.cause instanceof Error
      ? cause.cause.message.slice(0, 2000)
      : undefined,
  });
  return {
    error: 'The records could not be read. Try again. If the problem persists, contact support.',
    errorReference,
  };
}
