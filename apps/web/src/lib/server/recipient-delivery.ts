export interface RecipientDeliveryPlan {
  /** Addresses whose delivery requires the configured outbound provider. */
  externalRecipients: string[];
  /** Complete RFC-visible To list supplied to the provider. */
  providerTo: string[];
  /** Complete RFC-visible Cc list supplied to the provider. */
  providerCc: string[];
  /** Provider SMTP-envelope recipients (the complete visible set). */
  providerRecipients: string[];
  /** Recipients that may be persisted directly without changing visible headers. */
  localRecipients: string[];
}

/**
 * A mixed local/external message needs complete visible To/Cc headers while
 * only external addresses belong in the provider envelope. The Cloudflare raw
 * transport preserves that separation; local copies remain synchronous.
 */
export function planRecipientDelivery(
  to: ReadonlyArray<string>,
  cc: ReadonlyArray<string>,
  internalAddresses: ReadonlySet<string>,
  separateEnvelope = true,
): RecipientDeliveryPlan {
  const allRecipients = [...to, ...cc];
  const externalRecipients = allRecipients.filter((address) => !internalAddresses.has(address));
  const localRecipients = allRecipients.filter((address) => internalAddresses.has(address));
  if (externalRecipients.length) {
    return {
      externalRecipients,
      providerTo: [...to],
      providerCc: [...cc],
      providerRecipients: separateEnvelope ? externalRecipients : allRecipients,
      localRecipients: separateEnvelope ? localRecipients : [],
    };
  }
  return {
    externalRecipients: [],
    providerTo: [],
    providerCc: [],
    providerRecipients: [],
    localRecipients,
  };
}
