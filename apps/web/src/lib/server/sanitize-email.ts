// Keep this stable local import surface for existing routes and tests while
// sharing the exact sanitizer with the inbound Worker.
export {
  sanitizeEmailHtml,
  sanitizeEmailHtmlWithLinkGuard,
  type RiskyLink,
} from '@cmail/shared/sanitize-email';
