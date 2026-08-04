import { describe, expect, it } from 'vitest';
import { NO_FACTS, parseAuthenticationResults } from './authentication-results';

const BOUNDARY = 'mx.example.com';

describe('trust boundary', () => {
  it('produces nothing when no authserv-id is configured', () => {
    expect(parseAuthenticationResults('mx.example.com; spf=pass; dkim=pass; dmarc=pass', ''))
      .toEqual(NO_FACTS);
    expect(parseAuthenticationResults('mx.example.com; spf=pass', undefined)).toEqual(NO_FACTS);
  });

  it('ignores a record from a different authserv-id', () => {
    expect(parseAuthenticationResults('attacker.invalid; spf=pass; dkim=pass; dmarc=fail', BOUNDARY))
      .toEqual(NO_FACTS);
  });

  it('only reads the topmost record when headers were joined', () => {
    // Workers joins repeated headers with ", ". The boundary closest to us is
    // first; anything after it was added further out.
    const joined = 'mx.example.com; spf=pass; dmarc=pass, attacker.invalid; spf=fail; dmarc=fail';
    const facts = parseAuthenticationResults(joined, BOUNDARY);
    expect(facts.spf).toBe('pass');
    expect(facts.dmarc).toBe('pass');
  });

  it('refuses everything when an untrusted record is on top', () => {
    const joined = 'attacker.invalid; spf=pass; dmarc=pass, mx.example.com; spf=fail';
    expect(parseAuthenticationResults(joined, BOUNDARY)).toEqual(NO_FACTS);
  });

  it('matches the authserv-id case-insensitively and tolerates a version token', () => {
    expect(parseAuthenticationResults('MX.Example.COM 1; spf=pass', BOUNDARY).spf).toBe('pass');
  });

  it('rejects empty or malformed input', () => {
    expect(parseAuthenticationResults(null, BOUNDARY)).toEqual(NO_FACTS);
    expect(parseAuthenticationResults('', BOUNDARY)).toEqual(NO_FACTS);
    expect(parseAuthenticationResults('mx.example.com no-semicolon', BOUNDARY)).toEqual(NO_FACTS);
    expect(parseAuthenticationResults(`mx.example.com; spf=${'a'.repeat(5000)}`, BOUNDARY))
      .toEqual(NO_FACTS);
  });
});

describe('result extraction', () => {
  it('reads spf, dkim, dmarc and arc', () => {
    const facts = parseAuthenticationResults(
      'mx.example.com; spf=pass smtp.mailfrom=a@example.com; dkim=fail; dmarc=softfail; arc=none',
      BOUNDARY,
    );
    expect(facts.spf).toBe('pass');
    expect(facts.dkim).toBe('fail');
    expect(facts.dmarc).toBe('softfail');
    expect(facts.arc).toBe('none');
  });

  it('discards results outside the RFC 8601 registry', () => {
    const facts = parseAuthenticationResults('mx.example.com; spf=banana; dkim=pass', BOUNDARY);
    expect(facts.spf).toBeNull();
    expect(facts.dkim).toBe('pass');
  });

  it('does not match a method embedded in a longer token', () => {
    // "dkim-atps=pass" must not be read as a DKIM result.
    const facts = parseAuthenticationResults('mx.example.com; dkim-atps=pass', BOUNDARY);
    expect(facts.dkim).toBeNull();
  });

  it('normalises result casing', () => {
    expect(parseAuthenticationResults('mx.example.com; SPF=PASS', BOUNDARY).spf).toBe('pass');
  });

  it('handles "none" for a message with no authentication performed', () => {
    expect(parseAuthenticationResults('mx.example.com; none', BOUNDARY)).toEqual(NO_FACTS);
  });
});

describe('comments and quoting', () => {
  it('ignores commas inside RFC 5322 comments', () => {
    const facts = parseAuthenticationResults(
      'mx.example.com; spf=pass (sender ok, verified) smtp.mailfrom=a@example.com; dmarc=pass',
      BOUNDARY,
    );
    expect(facts.spf).toBe('pass');
    expect(facts.dmarc).toBe('pass');
  });

  it('ignores commas inside quoted strings', () => {
    const facts = parseAuthenticationResults(
      'mx.example.com; dkim=pass header.d="a,b.example.com"; dmarc=pass',
      BOUNDARY,
    );
    expect(facts.dkim).toBe('pass');
    expect(facts.dmarc).toBe('pass');
  });

  it('does not let a comment smuggle in a result', () => {
    const facts = parseAuthenticationResults('mx.example.com; spf=fail (dkim=pass)', BOUNDARY);
    expect(facts.spf).toBe('fail');
    expect(facts.dkim).toBeNull();
  });
});

describe('source address', () => {
  it('reads a dotted-quad from the trusted record', () => {
    const facts = parseAuthenticationResults(
      'mx.example.com; spf=pass smtp.remote-ip=203.0.113.9', BOUNDARY,
    );
    expect(facts.sourceIp).toBe('203.0.113.9');
  });

  it('reads a quoted IPv6 address and lowercases it', () => {
    const facts = parseAuthenticationResults(
      'mx.example.com; spf=pass policy.iprev="2001:DB8::1"', BOUNDARY,
    );
    expect(facts.sourceIp).toBe('2001:db8::1');
  });

  it('rejects a value that is not an address', () => {
    expect(parseAuthenticationResults('mx.example.com; spf=pass smtp.remote-ip=not-an-ip', BOUNDARY).sourceIp)
      .toBeNull();
    expect(parseAuthenticationResults('mx.example.com; spf=pass smtp.remote-ip=999.1.1.1', BOUNDARY).sourceIp)
      .toBeNull();
  });

  it('is null when the boundary publishes no address', () => {
    expect(parseAuthenticationResults('mx.example.com; spf=pass', BOUNDARY).sourceIp).toBeNull();
  });
});
