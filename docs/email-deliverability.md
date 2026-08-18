# Email deliverability setup (SPF, DKIM, DMARC)

WMIT sends client-facing documents (quotations, statements of account,
itineraries, receipts, vouchers) through the owner's domain mailbox over SMTP.
If the domain lacks sender authentication, those emails land in spam — staff
then conclude the system is broken and fall back to manual email.

**Status: DRAFT — blocked on the domain name and DNS access.** Replace
`<domain>` everywhere, then follow the checklist. Total effort: ~30 minutes
plus DNS propagation (up to a few hours).

## 1. Where DNS lives

The domain's nameservers decide where these records are edited:

- If the domain was delegated to Cloudflare (per the tunnel setup), DNS records
  go in the Cloudflare dashboard → DNS.
- If nameservers are still the registrar's (netcup CCP), records are edited
  there.

Confirm with `nslookup -type=NS <domain>`.

## 2. SPF (prevents sender forgery, easiest win)

One TXT record on the domain root. Pick the line that matches how the mailbox
is hosted and keep **only one** SPF record:

| Mailbox hosting | TXT record value |
|---|---|
| Google Workspace | `v=spf1 include:_spf.google.com ~all` |
| netcup mail / other provider | `v=spf1 include:<provider-spf-domain> ~all` |
| Only WMIT's server sends (rare) | `v=spf1 ip4:<server-ip> ~all` |

- Type: `TXT` · Host: `@` (root) · TTL: default/1h
- Two SPF records = both break. Merge includes into one line instead.

## 3. DKIM (cryptographic signature)

Requires the mailbox provider's DKIM key — there is no generic record:

- **Google Workspace:** Admin console → Apps → Google Workspace → Gmail →
  Authenticate email → Generate new record → copy the host (looks like
  `google._domainkey`) and value (starts `v=DKIM1; k=rsa; p=…`) into DNS as
  TXT.
- **Other providers:** look for "DKIM" in the provider's admin/help pages and
  copy their generated TXT record the same way.

## 4. DMARC (policy layer)

Start in monitor-only mode; tighten after two weeks of clean reports:

```
Type:  TXT
Host:  _dmarc
Value: v=DMARC1; p=none; rua=mailto:dmarc-reports@<domain>
```

After reports show legitimate mail passes SPF+DKIM (alignment), raise to
`p=quarantine` and later `p=reject`.

## 5. Verification checklist

1. `nslookup -type=TXT <domain>` shows exactly one SPF record.
2. `nslookup -type=TXT google._domainkey.<domain>` (or provider's selector)
   returns the DKIM key.
3. `nslookup -type=TXT _dmarc.<domain>` returns the DMARC record.
4. **Send a real test:** configure WMIT's SMTP (see
   `docs/deployment-netcup.md`), then email a document to a
   [mail-tester.com](https://www.mail-tester.com) address from the workspace
   (Finance → Client invoice → Email). Target score: 9/10 or better.
5. Check the DMARC report mailbox after 48h; no unexpected senders.
6. Repeat the mail-tester check after any SMTP/provider change.

## Troubleshooting

- **Fails SPF:** the WMIT server relays through the provider's SMTP — nothing
  extra is needed. Only if the server sends mail directly does its IP belong
  in SPF.
- **DKIM fails in mail-tester:** propagation lag (wait, retest) or the record
  was copied with quotes/line breaks — re-copy as a single line.
- **Gmail "via" banner:** DMARC alignment — the From address WMIT sends as
  (`WMIT_SMTP_FROM`) must be on the same domain as the mailbox.
