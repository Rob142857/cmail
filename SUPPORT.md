# Support

cmail is a community-maintained, self-hosted project. There is no hosted-service
or guaranteed-response support included with the MIT-licensed software.

## Before asking for help

1. Check the [documentation](docs/README.md), especially
   [configuration](docs/configuration.md) and
   [deployment verification](docs/deployment.md#verification).
2. Search [existing issues](https://github.com/Rob142857/cmail/issues) for the
   same symptom.
3. Run `pnpm validate` and note the first failing command.
4. Reduce the problem to a staging or local environment with non-sensitive test
   data.

Use a bug report for a reproducible cmail defect and a feature request for a
broadly useful product change. Include the affected commit, component,
deployment shape, safe reproduction steps, expected result, and actual result.

## Keep reports safe

Never post OAuth credentials, session values, API keys, Cloudflare account or
resource IDs, private message content, personal data, production URLs, raw
database exports, or unredacted logs. Replace deployment-specific values with
obvious examples such as `example.com`.

Report suspected vulnerabilities through the private process in
[SECURITY.md](SECURITY.md), not through a public support issue.

## Deployment-specific assistance

Cloudflare, Google, Microsoft, Postmark, DNS, privacy, and regulatory
questions may require the relevant provider or a qualified local professional.
Project maintainers cannot inspect or administer an operator's accounts and
cannot certify a deployment for a particular legal or assurance framework.
