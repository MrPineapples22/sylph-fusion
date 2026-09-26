import React from 'react';

const fields = [
  ['quality', 'Token quality', {PASS: 'Reported checks passed', FAIL: 'Reported quality defect'}],
  ['opportunity', 'Entry eligibility', {ELIGIBLE: 'Reported entry criteria passed', INELIGIBLE: 'Reported entry criteria failed', PENDING: 'Awaiting evidence or transition'}],
  ['execution', 'Execution authority', {AVAILABLE: 'Reported availability; inspect the operating envelope', BLOCKED: 'Reported execution restriction'}],
];

export function TokenClassification({token = {}, current = false}) {
  return <section className="op-section">
    <h2>Decision classification</h2>
    <p className="op-muted">Quality, eligibility and execution are separate evidence claims.</p>
    <dl className="op-classification-grid">{fields.map(([key, label, descriptions]) => {
      const observed = token[key];
      const known = typeof observed === 'string' && Object.hasOwn(descriptions, observed);
      return <div key={key}>
        <dt>{label}</dt>
        <dd>{current && known ? observed : 'UNKNOWN'}</dd>
        <p>{!current && known ? `Historical observation: ${observed}` : known ? descriptions[observed] : 'Evidence unavailable'}</p>
      </div>;
    })}</dl>
    <p className="op-muted">{current ? token.decision?.summary || 'Inspect the evidence and operating constraints before drawing a conclusion.' : 'Projection expired or disconnected. Historical observations do not establish current eligibility or authority.'}</p>
  </section>;
}
