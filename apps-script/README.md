# Apps Script layer

The Google Apps Script files now contain the fresh-Workspace bootstrap and controlled Sheets persistence boundary. They do not connect to any account until the owner deploys them into the newly linked Drive.

- WmitRuntime.gs accepts explicitly injected services.
- WmitServiceLayer.gs exposes a small representative API.
- WmitQuotationEditor.gs exposes the quotation editor contract without direct SpreadsheetApp calls.
- The Quotations tab in Index.html now uses that contract for manual draft creation, quotation-item editing, internal pricing review, client-safe preview, printing, and approval. It stores Quotation and QuotationItem records in the controlled Sheets tabs; it does not import the local Node runtime.
- WmitPaymentConversion.gs contains the same dependency-free integer conversion contract used by the local runtime. It records the actual payment currency and the invoice-currency equivalent for each installment.
- WmitWorkspace.gs creates one idempotent WMIT folder, one operational spreadsheet, controlled entity tabs, configuration, and audit log. It never deletes or overwrites files.
- WmitSheetServices.gs persists controlled records with immutable IDs, optimistic record versions, indexed relationship columns, and a canonical JSON payload for complex fields.
- WmitDriveServices.gs accepts controlled wholesaler-package, DMC-land-arrangement, other-tariff, and supporting-document uploads, requires a real Supplier ID for supplier sources, stores originals in typed Drive folders, and creates review-gated Document records in Sheets.
- WmitReviewServices.gs provides a review queue and interpretation confirmation. Confirmation records supplier, currency, rate basis, validity, and notes but deliberately does not make a source quotable.
- WmitOperationsServices.gs provides the operations-first domain boundary for Clients, Inquiries, follow-ups, communications, payment schedules, client payment entry/verification/allocation, multi-role Sub-agents, supplier payables/payments, and Cash Transactions. It validates currencies and relationships, supports idempotent finance-entry retries, voids ledger entries instead of deleting them, and derives finance summaries from Sheets records without depending on tariff extraction.
- WmitBookingServices.gs and the Bookings/Departures tabs provide the missing operational handoff: approved quotation acceptance, one Booking per quotation, mandatory lead passenger, copied Booking Items, Supplier Bookings, client commitment, supplier/departure readiness deadlines, departure membership, and amendment tracking with client re-acceptance before the Booking is confirmed again.
- WmitPublicServices.gs, PublicRequest.html, and PublicQuotation.html provide the bounded public channel: a custom quote request creates only a Client, Inquiry, and follow-up Task; an approved quotation can receive a non-guessable public link; public pages expose only client-safe quotation data.
- Inquiry triage uses one explicit sales path: CUSTOM_QUOTE and DMC_LAND_ARRANGEMENT route to the quotation queue, while WHOLESALER_PACKAGE routes to the Booking preparation queue. The latter is a work queue only; it does not bypass client acceptance, lead-pax selection, supplier confirmation, or financial safeguards.
- The Inquiry detail workspace can create or reopen the existing active quotation with client, travel, traveler-composition, requirements-snapshot, and Inquiry context carried into the draft. Repeated primary-action clicks reuse the active draft instead of creating duplicate quotations.
- The quotation editor now supports a structured day-by-day itinerary with date, city/area, title, activities/services, meals, hotel/overnight, and notes. Draft staff can add/remove days and save the complete itinerary; the existing client-safe preview/public quotation receives the saved itinerary data.
- Workspace initialization now has a verified fast path after the first successful setup, and Sheets persistence reuses the opened spreadsheet and header indexes during each request to reduce repeated Apps Script/Sheets overhead.
- WmitExtractionServices.gs stages OCR/text extraction into TariffSource, TariffExtractionFact, and TariffRateComponent records. It requires the Apps Script Advanced Drive service (Drive API v2); native Google Docs are exported through Drive and failures remain review-blocked.
- WmitWebApp.gs and Index.html provide the staff-facing operations workspace plus source intake, success card, review queue, Drive link, and interpretation-review page through `google.script.run`.
- Index.html now shows a global upper-right completion/error alert, keeps Workspace setup in its own Setup tab, labels Adults/Children/Infants in Inquiry capture, and keeps Source Documents focused on uploads and review.
- The Bookings and Departures tabs are separate from Finance. They are list-first and action-oriented; internal supplier costs remain in operational records and are not client-facing.
- The Pipeline, Clients, Dashboard action center, and Finance profit tracker are presentation layers over existing records. They do not introduce a second pipeline/status model or a universal commission percentage.
- WmitWebApp.gs provides WMIT-managed username/password authentication with expiring sessions and server-side Admin, Staff, and restricted Intern roles. Staff can handle client/inquiry/follow-up work and draft quotations; protected finance controls, source review, workspace setup, and quotation approval remain Admin-only. Interns receive an open-task-only view with no finance data or write actions.
- `initializeWmitSyntheticWorkspace_()` creates only two synthetic master records and is the first deployment smoke test; it is reachable through the Admin-only `webInitializeSyntheticWorkspace` wrapper.
- Privileged server functions are underscore-suffixed and therefore hidden from `google.script.run`. Only `doGet` and the authenticated `web*` wrappers are callable from the deployed page. Setup functions are run from the Apps Script editor or through their Admin-gated web wrappers.
- Passwords use per-user salts and iterated SHA-256 stretching. The temporary administrator password is returned once from the editor execution result and never written to execution logs.
- The Audit Log records old and new values for changed fields, failure entries for rejected creates/updates, and compensating `ROLLBACK_CREATE` entries when a multi-record transaction (for example Booking creation) is rolled back after a partial failure.
- The public quote-request channel is rate limited per submitter and globally; idempotent retries are never blocked by the limiter.
- There are no hard-coded spreadsheet IDs, folder IDs, credentials, or direct production writes.

## Finance ledger boundary

The Finance tab supports four distinct concepts:

- verified client payments;
- recorded supplier payments and supplier payables;
- manual Cash Transactions for opening balance, other income, expenses, and refunds.

The calculated cash position is shown by currency and is only as complete as the entered opening balance and movements. No foreign-exchange conversion is performed. There is deliberately no separate bank-account module in this phase.

The local implementation and tests live under src/. The reusable calculation/preview module at `src/application/quotation-editor.js` is dependency-free and uses a UMD wrapper: Node can `require()` it and Apps Script can load it as a global `WmitQuotationEditor`. PDF/office extraction uses Drive conversion/OCR to produce candidates; the current UI never guesses tariff facts from a file. A tariff remains blocked until interpretation, extracted candidates, and activation notes are explicitly confirmed. Automated quotation is deliberately deferred while the operations-first workflow is accepted.

## Access setup

This version does not require Google Workspace accounts. After adding the files to Apps Script, open WmitWebApp.gs and run `initializeWmitLoginSystem_()` once from the Apps Script editor (place the cursor inside the function and press Run). Copy the generated temporary `admin` password from the execution result — it is never written to the execution log — open the web app, and sign in. In Setup → WMIT user accounts, create the three Admin, three Staff, and one Intern WMIT accounts. Admins can later reset passwords, activate or disable accounts, and change roles. Each user can also change their own password. Passwords are stored as salted, iterated hashes; the app stores only the temporary browser session token in session storage. Sessions expire after six hours and failed sign-ins are rate-limited.

Deploy the web app as the owner with access set to anyone who has the deployment URL. Because this is application authentication, protect the deployment URL, use strong unique passwords, and do not treat it as a replacement for enterprise identity management. For production-scale or highly sensitive use, migrate authentication to a proper identity provider later.
