# Inbox rules

Rules act on new mail as it arrives in a mailbox's Inbox, like rules in
Outlook (**Settings > Mail > Rules**). In cmail they live under
**Mail > Settings > Rules** (`/mail/rules`).

## Who can set rules

Anyone with **full access** to a mailbox: you, for your own mailbox, and the
people a Manager has given full access to a shared mailbox. Rules belong to the
mailbox, not the person, so everyone with full access to a shared mailbox sees
and edits the same rules. Every change is recorded in the audit log.

## What a rule is made of

- **Conditions.** The rule applies only when every condition matches. Where a
  condition takes several values, any one of them is enough: `From` with
  `ann@example.com; example.org` matches mail from Ann or from anyone at
  example.org (and its subdomains).
- **Actions.** What happens to a message that matches.
- **Exceptions** (optional). If any exception matches, the rule is skipped.
- **Stop processing more rules.** On by default, as in Outlook: once this rule
  applies, the rules below it are skipped for that message.

| Conditions and exceptions | Notes |
| --- | --- |
| From | Addresses or domains |
| Sent to | An address or domain on the To or Cc line |
| Subject includes, Subject or body includes, Message body includes | Words or phrases, separated by semicolons; case doesn't matter |
| Sender address includes, Recipient address includes | Part of an address, such as `noreply` |
| Message header includes | Text anywhere in the header, such as `List-Id` |
| My address is on the To line / on the Cc line / on the To or Cc line / not on the To line / the only recipient | Uses the mailbox's own address |
| Has an attachment, Importance is, Size is at least / at most | Size in KB |
| Apply to all messages | Conditions only |

| Actions | Notes |
| --- | --- |
| Move to Archive, Junk or Deleted | |
| Mark as read | |
| Star it | cmail's equivalent of Outlook's flag |
| Mark with importance | High, normal or low |

## How rules run

Rules run in the order shown on the Rules page; use the arrows to reorder them.
When several rules apply to one message, the first rule that moves it decides
its folder, and the first that sets importance decides that. Marking read and
starring add up. A message a rule moves out of the Inbox or marks read doesn't
raise a new-mail alert.

Rules run on mail from outside the organisation and on mail sent between cmail
mailboxes. They run **after** the organisation's junk filtering and sender
rules (see [Spam and quarantine](spam-and-quarantine.md)): mail the
organisation files to Junk never reaches your rules, so a rule can't bring it
back to the Inbox. Mail trace shows which rules acted on each delivery.

A mailbox can have up to 50 rules. A rule can be turned off without deleting
it.

## Starting a rule

- Choose **New rule** on the Rules page.
- Or open a message and choose **Create rule** (on a phone, it's under **More
  actions**). The editor starts with that sender in **From**.

## Run rule now

New rules only see mail that arrives after they are saved. To apply a rule to
mail that has already arrived, tick **Run it now on the Inbox** when saving, or
choose **Run now** on the Rules page. It looks at the 1,000 newest messages in
the Inbox.

Rules that look at the **message body** or **header** can't run now. cmail
keeps the readable copy of a message, not the original body text and header,
so those rules only apply to new mail.

## What cmail rules don't do

Some Outlook actions are deliberately left out:

- **Forward, redirect or send a copy elsewhere.** Automatic forwarding is one
  of the most common ways mail leaks out of an organisation, and Microsoft
  turns it off by default for the same reason. Ask a Manager about shared
  mailboxes or delegation instead.
- **Permanently delete.** Use **Move to Deleted**: retention still applies,
  and the message can be restored if a rule was too broad.
- **Move to a folder of your own, categorise, or pin.** cmail doesn't have
  custom folders, categories or pinning yet.

## For operators

Rules are stored in the `inbox_rules` table (migration `0018`). Apply it with
`pnpm db:migrate` before deploying the new email worker and web app. Until the
table exists, delivery carries on as if no mailbox had rules, and the Rules
page can't load.
