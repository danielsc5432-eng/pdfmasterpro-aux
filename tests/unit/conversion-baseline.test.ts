import test from "node:test";
import assert from "node:assert/strict";
import { baselineFailures, checkedCases, reviewCases, knownOcrTruth } from "../../scripts/conversion-baseline";
const results=()=>[...checkedCases.map(name=>({name,outcome:"checked"})),...reviewCases.map(name=>({name,outcome:"review"}))];
test("baseline distinguishes expected reviews from lost approvals and missing evidence",()=>{
  assert.deepEqual(baselineFailures(results()),[]);
  const regression=results();regression[0].outcome="review";
  assert.ok(baselineFailures(regression).some(message=>message.includes("approval regressed")));
  assert.ok(baselineFailures(results().slice(1)).length);
  assert.ok(baselineFailures([...results(),results()[0]]).length);
  const blocked=results();blocked.at(-1)!.outcome="blocked";
  assert.ok(baselineFailures(blocked).length);
});
test("OCR reference requires the real amount, sign and every known word",()=>{
  const text="SCANNED FINANCIAL STATEMENT Total 1234.56 This statement contains credit and debit details for review";
  assert.equal(knownOcrTruth("scanned-statement.pdf",text)?.passed,true);
  assert.equal(knownOcrTruth("scanned-statement.pdf",text.replace("1234.56","1234.5"))?.passed,false);
  assert.equal(knownOcrTruth("scanned-statement.pdf",text.replace("1234.56","-1234.56"))?.passed,false);
  assert.equal(knownOcrTruth("scanned-statement.pdf",text.replace("debit ",""))?.passed,false);
  assert.equal(knownOcrTruth("unknown.pdf",text),undefined);
});
