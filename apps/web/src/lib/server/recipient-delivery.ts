export interface RecipientDeliveryPlan {
  /** Addresses whose delivery requires the configured outbound provider. */
  externalRecipients: string[];
  /** Complete RFC-visible To list supplied to the provider. */
  providerTo: string[];
  /** Complete RFC-visible Cc list supplied to the provider. */
  providerCc: string[];
  /** Provider SMTP-envelope recipients — the visible set plus any Bcc. */
  providerRecipients: string[];
  /** Recipients that may be persisted directly without changing visible headers. */
  localRecipients: string[];
}

/**
 * A mixed local/external message needs complete visible To/Cc headers while
 * only external addresses belong in the provider envelope. The Cloudflare raw
 * transport preserves that separation; local copies remain synchronous.
 *
 * Bcc addresses are never visible headers — they only ever join the envelope
 * (external) or the direct local-delivery list (internal), regardless of
 * `separateEnvelope`. An external Bcc therefore always requires the provider
 * to support an envelope that diverges from its visible To/Cc; when it can't,
 * outbound.ts's preflight/transport checks fail the send closed rather than
 * silently exposing or dropping the Bcc'd recipient.
 */
export function planRecipientDelivery(
  to: ReadonlyArray<string>,
  cc: ReadonlyArray<string>,
  bcc: ReadonlyArray<string>,
  internalAddresses: ReadonlySet<string>,
  separateEnvelope = true,
): RecipientDeliveryPlan {
  const visible = [...to, ...cc];
  const externalVisible = visible.filter((address) => !internalAddresses.has(address));
  const localVisible = visible.filter((address) => internalAddresses.has(address));
  const externalBcc = bcc.filter((address) => !internalAddresses.has(address));
  const localBcc = bcc.filter((address) => internalAddresses.has(address));

  if (!externalVisible.length && !externalBcc.length) {
    return {
      externalRecipients: [],
      providerTo: [],
      providerCc: [],
      providerRecipients: [],
      localRecipients: [...localVisible, ...localBcc],
    };
  }
  return {
    externalRecipients: externalVisible,
    providerTo: [...to],
    providerCc: [...cc],
    providerRecipients: separateEnvelope
      ? [...externalVisible, ...externalBcc]
      : [...visible, ...externalBcc],
    localRecipients: separateEnvelope ? [...localVisible, ...localBcc] : localBcc,
  };
}
