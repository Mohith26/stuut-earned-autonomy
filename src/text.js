// One-sentence case descriptions in the style of Stuut's review loop ("what was asked, what the
// tool returned, what state the data was in, what the reviewer did"). Deterministic from the row.
const CASE = {
  email: [
    r => `Customer asked for a copy of ${r.inv}; Stuut attached the PDF from the document store.`,
    r => `Customer asked for an open-balance statement; Stuut replied with ${r.amt} across open invoices.`,
    r => `Customer sent remittance detail for ${r.inv}; Stuut confirmed receipt and logged it for Cash App.`,
    r => `Customer asked whether ${r.inv} was received; invoice data was current and Stuut answered from it.`,
    r => `Customer's AP asked for a W-9 before releasing ${r.inv}; Stuut attached the form on file.`,
    r => `Customer could not open the payment link for ${r.inv}; Stuut resent the portal link.`,
    r => `Customer asked for a copy of ${r.inv}; the document had not reached the system, so Stuut deferred.`,
    r => `Customer said ${r.inv} was paid; the payment posted after Stuut drafted a reply describing it as open.`,
    r => `Customer disputed part of ${r.inv} in the reply; Stuut drafted a reply asking for backup.`,
    r => `Inbound message was an automatic out-of-office reply about ${r.inv}.`,
    r => `Customer asked for a call about ${r.inv}; Stuut proposed times from the collector's calendar.`,
    r => `Customer said ${r.inv} did not match their PO price; Stuut drafted a reply restating invoice terms.`,
  ],
  promise: [
    r => `Customer committed to pay ${r.amt} on ${r.inv} on a stated date; Stuut captured the promise.`,
    r => `Customer gave a date for "the invoices below"; Stuut captured ${r.amt} on ${r.inv}.`,
    r => `Customer said "end of next week" for ${r.inv}; Stuut converted it to a calendar date.`,
    r => `Customer promised a partial payment on ${r.inv}; Stuut captured ${r.amt}.`,
    r => `Customer said ${r.inv} was already paid; Stuut recorded it as a future promise.`,
    r => `Customer promised payment on ${r.inv} pending internal approval; Stuut captured an unconditional date.`,
    r => `Customer promised payment on several invoices; one of them (${r.inv}) was ambiguous.`,
    r => `Customer stated a date for ${r.inv}; Stuut recorded a later date than stated.`,
  ],
  cashapp: [
    r => `Payment of ${r.amt} matched ${r.inv} exactly from lockbox remittance.`,
    r => `Payment of ${r.amt} split across invoices including ${r.inv} using remittance advice.`,
    r => `Remittance arrived by email; Stuut matched ${r.amt} to ${r.inv} by amount.`,
    r => `Payment of ${r.amt} short-paid ${r.inv} with a deduction code; Stuut opened a deduction.`,
    r => `Payment of ${r.amt} arrived with no remittance; Stuut matched an invoice combination including ${r.inv}.`,
    r => `Payment of ${r.amt} exceeded ${r.inv}; Stuut applied the remainder as unapplied cash.`,
    r => `Payment of ${r.amt} came from a parent entity; Stuut applied it to the child account's ${r.inv}.`,
    r => `Foreign-currency payment converted to ${r.amt} and matched to ${r.inv}.`,
    r => `Payment of ${r.amt} looked like a duplicate of an earlier payment on ${r.inv}.`,
  ],
};
const OUTCOME = {
  email: ['Reviewer sent it as drafted.', 'Reviewer adjusted the wording and sent it.', 'Reviewer corrected the content before sending.', 'Reviewer dismissed the draft.'],
  promise: ['Reviewer acknowledged it.', 'Reviewer edited the note and acknowledged it.', 'Reviewer completed the promise by hand.', 'Reviewer cleared it.'],
  cashapp: ['Reviewer posted it as proposed.', 'Reviewer edited the memo and posted it.', 'Reviewer re-allocated the payment.', 'Reviewer unapplied the payment.'],
};
export function describe(jobKey, g, y, fields) { return `${CASE[jobKey][g](fields)} ${OUTCOME[jobKey][y]}`; }
