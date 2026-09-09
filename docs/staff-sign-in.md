# Staff portal sign-in contract

A staff portal can link to `APP_URL` + `/mail`. An existing, valid cmail
session opens the user's assigned mailboxes; otherwise the browser reaches
cmail's sign-in page. The portal sends no identity headers, credentials,
email address, role, or mailbox identifier. cmail owns its session cookie,
policy acceptance, account status, and mailbox authorization.
The portal may show this link to all authenticated staff when a mail origin
is configured, without maintaining a duplicate mailbox-enabled flag. Link
visibility grants no cmail account, role, or mailbox access.

For a portal that explicitly offers a configured provider, optional shortcuts
are `APP_URL` + `/auth/login/google?sso=1` and
`APP_URL` + `/auth/login/microsoft?sso=1`. These are browser navigation URLs,
not token-exchange APIs. Use the provider already bound to that cmail account;
do not infer it from an email address or an Access session. Keep `/mail` as
the provider-neutral mailbox card destination.

The shortcut reuses a validated cmail session when present. Otherwise it
starts the ordinary authorization-code flow, with fresh state and S256 PKCE,
but omits the forced account chooser. The provider may still require login,
consent, MFA, or account selection. This does not promise silent sign-in.
Ordinary sign-in links and requests carrying enrollment/bootstrap intent
retain `prompt=select_account`. No query-string redirect or identity hint is
forwarded. Errors return to the normal sign-in page; there is no automatic
retry loop. To choose another account, use its normal sign-in button.

## Identity and Access boundary

Returning OAuth sign-in resolves `user_identities(provider, subject)` from
access-token-backed UserInfo. Google uses
`https://openidconnect.googleapis.com/v1/userinfo`; Microsoft uses
`https://graph.microsoft.com/oidc/userinfo`. There is no stored issuer column
or generic JWT/ID-token issuer validator in this flow: the provider namespace
is fixed by server-selected endpoints and the configured OAuth application.
Do not change the OAuth client registration as a shortcut to federation.

Cloudflare Access is eligible as an additional edge gate, but its claims are
not eligible to create a cmail session in this implementation. No Access JWT
verifier or Access-to-cmail account binding exists. Access `sub` is an Access
user identifier; Microsoft's `sub` is application-specific, so neither an
Access subject nor a subject from another Microsoft application can be
substituted for cmail's existing provider subject. A matching email is never
authority to link accounts. See the [Access application-token reference](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/application-token/)
and [Microsoft claim reference](https://learn.microsoft.com/en-us/entra/identity-platform/id-token-claims-reference).

A future Access session bridge would require reviewed mail-application
issuer/audience/JWKS configuration, cryptographic token validation and time
checks, human identity eligibility, and explicit approved immutable account
bindings. An email header, Access service token, or museum role cannot grant
mail access or manager status. This change adds none of those trust paths.
Invitation, bootstrap proof/nonce, callback state/PKCE, CSRF, country gates,
session revocation, roles, and mailbox assignments remain in force.

## Live configuration still needs verification

- Confirm the mail origin and existing provider configuration in each lane.
  Register exactly `APP_URL` + `/auth/callback/google` and/or
  `/auth/callback/microsoft` on the corresponding existing OAuth application.
- Verify the intended staff account already has its provider binding and
  mailbox assignment. New users use the existing manager invitation flow;
  no automatic provisioning, merging, or email-based linking is added.
- If Access protects mail, review its own application audience, issuer,
  allowed staff/IdP policy, MFA/session requirements, and protection of both
  custom and direct Pages origins. Keep preview isolated. Access admission
  alone does not establish cmail eligibility.
- Rehearse browser behavior with the same provider session, multiple accounts,
  signed-out providers, rejected consent, revoked/paused accounts, and pending
  policy acceptance. Provider session reuse depends on browser and IdP policy.

No migration, new secret, provider registration change, or Access setting is
required by the optional shortcut itself. Local tests do not verify live
configuration or authorize deployment.
