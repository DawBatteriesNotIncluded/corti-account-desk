# Demo: a real session

Recorded on the provided data with `corti-s1-instant`, then copied in
unedited: `npm run brief`, and `npm run ask` for the questions. The lines in
brackets after each answer are printed by the tool itself: time taken, which
lookups it made, and anything the fact-check couldn't find in the data.

How to read it:
- `[CRM]`, `[Usage]` and `[Billing]` say where each fact came from.
- `(inferred ...)`, `ESTIMATE` and `Suggested:` mark interpretations and advice, not recorded facts.
- Confidence always comes with its reason.

One flaw shows up below and has been left in on purpose: the model tagged a
computed priority score `[CRM]`. That's a mislabel the fact-check doesn't
catch, because the check only verifies that numbers and quotes exist in the
data, not which source they came from.

## Opening brief (no LLM)

```

TODAY  2025-03-14   whole book (200 accounts) · 8 need attention
Data as of 2025-03-14, the last day in both CRM and analytics. Ranked by signal strength, value at
stake and match confidence.

────────────────────────────────────────────────────────────────────────────────────────────────────
1. CrestlineMedical Healthcare  [AT RISK]  ● high
   acc_022 · customer · owner david.okafor · priority 87
   • Production usage -28% (last 28 days vs prior 28) with renewal in 60 days ($145k)
     [CRM+Usage+Billing]
   • Meeting on 2025-03-08 recorded as negative [CRM]
   • Note 2025-03-08: "Upgrade concerns; AE needs to follow up on dissatisfaction." [CRM]
   Suggested: Book a call with Drew Taylor (Chief Medical Officer; role inferred from title) before
              the renewal; find out why usage dropped
   Why this confidence: headline signal is high; account match is high (domain)
────────────────────────────────────────────────────────────────────────────────────────────────────
2. CascadePartners Group  [AT RISK]  ● high
   acc_008 · mvp · owner noah.patel · priority 70
   • $1.02M deal but only 37 product requests in 90 days (trial: 9 in the last 28 days vs 14
     before) [CRM+Usage]
   • Premium enterprise contract $1.02M (mvp) closes in 30 days, next step: Finalize contract [CRM]
   Suggested: Get a trial success plan agreed with Kai Miller (VP Engineering; role inferred from
              title) before the close date
   Why this confidence: headline signal is high; account match is high (domain)
────────────────────────────────────────────────────────────────────────────────────────────────────
3. CobaltSurgical  [AT RISK]  ● high
   acc_127 · customer · owner linda.garcia · priority 66
   • Production usage -31% (last 28 days vs prior 28) with renewal in 65 days ($32k)
     [CRM+Usage+Billing]
   • prepaid contract $53k has 12.4% ($7k) left, term ends 2025-11-02 [Billing]
   • Renewal in 65 days ($32k) - CRM renewal date 2025-05-18, contract term ends 2025-11-02
     [CRM+Billing]
   Suggested: Book a call with Avery Miller (Head of Revenue Cycle; role inferred from title)
              before the renewal; find out why usage dropped
   Why this confidence: headline signal is high; account match is high (domain)
────────────────────────────────────────────────────────────────────────────────────────────────────
4. TrinitySpecialty LLC  [AT RISK]  ● high
   acc_002 · evaluation · owner sarah.kim · priority 63
...
```

## Conversation

```

### What should I do first today?
  ↳ looking up today_brief({})
  Top of today's brief (whole book, as of 2025-03-14):

  1. CrestlineMedical Healthcare (acc_022) - priority 87, risk
  • Production usage -28% (last 28 vs prior 28), renewal in 60 days ($145k) [CRM+Usage+Billing]
  • Meeting 2025-03-08 recorded as negative; note: "Upgrade concerns; AE needs to follow up on
    dissatisfaction." [CRM]
  • Suggested: call Drew Taylor (Chief Medical Officer; role inferred from title) before the
    renewal to find out why usage dropped (suggestion, not from the CRM)
  • Confidence: ● high. Caveats: meeting attendees not recorded; CRM renewal date and contract end
    date disagree by 30+ days.

  2. CascadePartners Group (acc_008) - priority 70, risk
  • $1.02M deal (mvp) closing in 30 days, but only 37 product requests in 90 days (trial: 9 vs 14
    prior) [CRM+Usage]
  • Suggested: agree a trial success plan with Kai Miller (VP Engineering; role inferred from
    title) before close (suggestion)
  • Confidence: ● high.

  3. CobaltSurgical (acc_127) - priority 66, risk
  • Usage -31%, renewal in 65 days ($32k); prepaid $53k contract has 12.4% ($7k) left, term ends
    2025-11-02 [CRM+Usage+Billing]
  • Suggested: call Avery Miller (Head of Revenue Cycle; role inferred from title) before renewal
    (suggestion)
  • Confidence: ● high. Caveat: renewal date vs contract end date disagree by 30+ days.

  4. TrinitySpecialty LLC (acc_002) - priority 63, risk
  • $743k deal (evaluation) closing in 45 days, only 88 requests in 90 days (trial: 20 vs 22 prior)
    [CRM+Usage]
  • Suggested: trial success plan with Noah Taylor (Platform Engineer; role inferred from title)
    (suggestion)
  • Confidence: ● high.

  Also worth a look today: SolsticeNetwork Inc (acc_099) and IronwoodHealth (acc_007) -
  growing usage with only ~12-14% of prepaid balance left; top-up/expansion opportunities
  [Billing+Usage].

  Suggested: start with CrestlineMedical - biggest renewal ($145k) closest in time (60 days) with a
  negative meeting on record. Want me to pull the full account detail on it?
[10.4s | tools: today_brief | unsupported: none]

### Tell me about CrestlineMedical: contacts, notes and MEDDPICC gaps
  ↳ looking up get_account({"query":"acc_022"})
  CrestlineMedical Healthcare (acc_022) - customer, Ambulatory, 3,557 employees, mid-market,
  owner david.okafor [CRM]

Situation
  • Renewal $145k due 2025-05-13 (60 days) [CRM]
  • Credit contract $171k, 59% ($101k) left, term 2024-11-13 → 2025-09-09; runway ~174 days
    (ESTIMATE, assumes linear burn) [Billing]
  • Production usage -28% (1127 vs 1567 requests, last 28 vs prior 28); tokens -35%, transcribe
    -26%; weekly series shows steady decline from 561 → 242 [Usage]
  • Priority 87, top risk in the book [CRM]

  Contacts (roles inferred from titles)
  • Drew Taylor - Chief Medical Officer - drew.taylor@crestline-medical.example - inbound email
    2025-03-08 ("Re: follow up on the pilot"); likely economic buyer and champion (inferred) [CRM]
  • Milo Johnson - Medical Director - no recorded email [CRM]
  • Ethan Thomas - IT Director - no recorded email [CRM]
  • Riley Lopez - Practice Manager - no recorded email [CRM]
  • Riley Wilson - Director of Clinical Informatics - no recorded email [CRM]
  • Ivy Johnson - Practice Manager - no recorded email [CRM]

Notes / activity
  • 2025-03-08: meeting, outcome negative (attendees not recorded) [CRM]
  • 2025-03-08 note: "Upgrade concerns; AE needs to follow up on dissatisfaction." [CRM]
  • 2025-03-08: inbound email from Drew Taylor [CRM]
  • Last CRM contact 6 days ago; no CRM next step recorded [CRM]

Open tasks (both overdue)
  • Resolve open support ticket - due 2025-03-04 [CRM]
  • Check-in on security review - due 2025-03-06 [CRM]

MEDDPICC
  • M Metrics - concern: usage declining -28%, 59% contract balance left [Usage+Billing]
  • E Economic buyer - likely Drew Taylor (Chief Medical Officer), inferred from title; persona
    field unreliable [CRM]
  • D1 Decision criteria - "Check-in on security review" (inferred by keyword match) [CRM]
  • D2 Decision process - renewal $145k recorded as won, date 2025-05-13 [CRM]
  • P Paper process - unknown, no step recorded [CRM]
  • I Identify pain - concern: negative meeting, dissatisfaction note, open support ticket [CRM]
  • C1 Champion - Drew Taylor, inferred from inbound email [CRM]
  • C2 Competition - not captured in the CRM [CRM]

  Gaps to close: Paper process (signatory/terms), Competition, and why usage dropped. Also
  reconcile the renewal date (2025-05-13) vs contract end (2025-09-09) - they disagree by over 30
  days [CRM+Billing].

  Suggested: call Drew Taylor this week to follow up on the 2025-03-08 dissatisfaction and the
  overdue support ticket, before the renewal. Confidence: ● high (domain-matched account,
  high-confidence signals; caveat: meeting attendees not recorded).

  Want me to create a follow-up task or add a note?
[9.6s | tools: get_account | unsupported: none]

### What is Ironwood Health using?
  ↳ looking up get_usage({"query":"IronwoodHealth"})
  IronwoodHealth (acc_007) - production usage, last 28 days vs prior 28 [Usage]

Volume
  • Requests: 1297 vs 883, +47%
  • Tokens: 4,538,503 vs 3,569,393, +27%
  • Transcription: 2348 vs 1771 units, +33% (unit not documented in the data)

Projects (both production)
  • ironwoodhealth-prod: 1162 requests last 28d (2523 over 90d)
  • ironwoodhealth-new: 135 requests last 28d (290 over 90d)

  Product mix (last 28d) - descriptive only, same fixed mix across all customers in this
  dataset
  • Agents: encounter-copilot 23%, billing-copilot 21%, coding-agent 21%, admin-assistant 21%, none
    14%
  • Models: corti-transcribe-v2 38%, corti-s1 32%, corti-s1-beta 29%
  • Routes: /stream/facts/ 21%, /tools/coding/ 20%, /interactions/:id/documents/ 20%,
    /interactions/:id/transcripts/ 20%, /v1/chat/completions 19%
  • Languages: none 15%, de 14%, da 13%, fr 12%, sv 12%, en 11%, nl 11%, es 11%
  • Sources: web-app 40%, copilot-api-v2 21%, sdk 19%, api-gateway 19%

  Trend: weekly production requests rising steadily: 106 → 346 over 12 weeks [Usage]

  Suggested: this is the growth account flagged earlier - usage up strongly with only ~12-14% of
  prepaid balance left [Billing+Usage]. A top-up/expansion conversation is timely. Want the full
  account detail?
[7.7s | tools: get_usage | unsupported: none]

### What is your favourite dog breed?
  I can only help with your accounts, pipeline and product usage, so I can't answer that.

  Suggested tasks for today instead (from the ranked brief; suggestions, not from the CRM):
  1. CrestlineMedical Healthcare (acc_022): Book a call with Drew Taylor (Chief Medical Officer;
     role inferred from title) before the renewal; find out why usage dropped
  2. CascadePartners Group (acc_008): Get a trial success plan agreed with Kai Miller (VP
     Engineering; role inferred from title) before the close date
  3. SolsticeNetwork Inc (acc_099): Propose a top-up or expansion before the balance runs out
     (usage is growing)

  Try: "Tell me about CrestlineMedical Healthcare", "What's at risk?" or "Create a task for #1".
[0.5s | tools: off_topic | unsupported: none]
```

The off-topic question gets a fixed reply that code writes, not the model:
a refusal followed by suggested tasks from the brief. CRM writes such as
`create_task` and `add_note` always stop at a y/N confirmation in the
interactive chat.
