# Wallet connection research

Checked September 18, 2026. This is a feasibility record, not an installed integration or a successful connection to a personal account.

| Service | Evidence | TishOS route |
| --- | --- | --- |
| Cash App | Monarch's live connection search lists MX and “Issues reported.” Its Sutton Bank result explicitly excludes Cash App. SimpleFIN's public institution search returns Cash App. | A SimpleFIN adapter in Controller is a practical candidate; it is not implemented in this release. An ordinary Plaid bank-account link does not establish access to the Cash App ledger. |
| Venmo Personal | Monarch's live connection directory lists Plaid, with one additional provider. | Try the existing Controller/Plaid Connect workflow, subject to the user's Plaid product access and current institution coverage. No personal connection was tested. |
| PayPal | Monarch's live directory lists Plaid with issues reported and one additional provider. | Same existing Plaid path, with account-specific connection testing still required. PayPal Credit and a PayPal wallet are distinct products. |

Primary coverage sources: [Monarch connection status](https://www.monarch.com/connection-status), [Monarch's explanation of Plaid, MX and Finicity](https://help.monarch.com/hc/en-us/articles/33707613533972-Understanding-Data-Providers-and-Connections), and [SimpleFIN supported-institution search](https://beta-bridge.simplefin.org/search-institutions). The Cash App result was checked through the search UI. Presence in a directory is not evidence that a particular account will authenticate or stay connected.

SimpleFIN charges [$1.50 plus tax monthly or $15 plus tax yearly](https://beta-bridge.simplefin.org/) for up to 25 institutions and 25 apps. It [uses MX for bank access](https://beta-bridge.simplefin.org/info/security). It therefore provides a small personal integration path to evaluate before seeking a direct commercial MX agreement, but cannot independently remove an upstream MX/Cash App outage. The same security page discloses a May 2026 MX account-data mixing incident; review that disclosure when choosing the service.

The [developer guide](https://beta-bridge.simplefin.org/info/developers) documents a one-time setup-token exchange for an access URL and read-only account/transaction retrieval. It expects no more than 24 requests per day, at most 90 days per query, and overlapping date windows to pick up corrections. A scripted demo attempt stopped at an HTTP 403 while fetching the developer page; no access token was claimed and no transaction API or real account was tested.

## Suggested implementation boundary

Keep provider authentication, the access URL and polling on the existing always-running Controller, in its device-local SecretStorage. Reuse Finances' account/transaction note importer and normal vault synchronization for phones and tablets. A new provider must namespace its connection/account/transaction IDs and expose the last successful import and per-account errors. It must not assume that a record absent from a date-window response was deleted. Pending-to-posted transitions, overlapping downloads, partial failures, currencies, corrected descriptions and migration from another provider need behavioral tests before enabling real imports.

Cash App funding movements that also appear at a linked bank need transfer treatment. Importing both sides as expenses would double-count spending; money spent from the Cash App balance is a separate transaction. Reconciliation should use provider identifiers and explicit account ownership, not merge unrelated records just because their amount and date match.

Cash App's public [Cash App Pay API](https://developers.cash.app/cash-app-pay-partner-api/guides/technical-guides/payment-processing/payment-flow-operations) is a merchant payment integration, not a documented consumer-ledger export API. Routing/account numbers or adding a card to Apple Wallet are not equivalent to a transaction-data connection.

For services whose automatic connector is unavailable, [Venmo CSV statements](https://help.venmo.com/cs/articles/transaction-history-vhel281) and [PayPal activity exports](https://www.paypal.com/us/cshelp/article/how-do-i-view-and-download-statements-and-reports-help145) provide a potential import fallback. No wallet-specific statement importer, connection, paid subscription, or email-monitoring workflow was added here.
