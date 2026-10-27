import test from "node:test";
import assert from "node:assert/strict";
import { tryVerifiedConversion } from "../../lib/processing/conversion-policy";
import type { FidelityReport } from "../../lib/processing/docx-fidelity";

const report:FidelityReport={sourcePages:1,outputPages:1,sameDimensions:true,textCoverage:1,numberCoverage:1,numberPrecision:1,renderedNumberCoverage:1,renderedNumberPrecision:1,renderedTextCoverage:1,numberPositionCoverage:1,visualSimilarity:.99,worstPageSimilarity:.99,ocrReview:false};
test("a failed primary conversion does not prevent a verified fallback",async()=>{
  const options={deadline:100000,now:()=>0,verify:async()=>report};
  assert.equal(await tryVerifiedConversion(async()=>{throw Error("engine failure");},options),null);
  const next=await tryVerifiedConversion(async()=>new Uint8Array([7]),options);
  assert.equal(next?.output[0],7);assert.equal(next?.report,report);
});
test("unverified output cannot be retained as a successful candidate",async()=>{
  assert.equal(await tryVerifiedConversion(async()=>new Uint8Array([7]),{deadline:100000,now:()=>0,verify:async()=>null}),null);
  assert.equal(await tryVerifiedConversion(async()=>new Uint8Array([7]),{deadline:100000,now:()=>0,verify:async()=>{throw Error("verification failure");}}),null);
});
test("expired budgets do not start engines or call verification after time runs out",async()=>{
  let time=0,calls=0;
  const options={deadline:20000,now:()=>time,verify:async()=>{calls++;return report;}};
  assert.equal(await tryVerifiedConversion(async budget=>{assert.ok(budget<=10000);time=19000;return new Uint8Array([7]);},options),null);
  assert.equal(calls,0);
  assert.equal(await tryVerifiedConversion(async()=>{throw Error("must not start");},options),null);
});
