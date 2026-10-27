import test from "node:test";
import assert from "node:assert/strict";
import { betterFidelity, fidelityScore, fidelityStatus, unsafeFidelity, type FidelityReport } from "../../lib/processing/docx-fidelity";
const good=():FidelityReport=>({sourcePages:2,outputPages:2,sameDimensions:true,textCoverage:1,numberCoverage:1,numberPrecision:1,renderedNumberCoverage:1,renderedNumberPrecision:1,visualSimilarity:0.97,worstPageSimilarity:0.95,ocrReview:false});
test("a successful export alone cannot be reported as checked",()=>{
  assert.equal(fidelityStatus(null),"unavailable");
  assert.equal(fidelityStatus(good()),"checked");
  assert.equal(fidelityStatus({...good(),ocrReview:true}),"review");
  assert.equal(fidelityStatus({...good(),visualSimilarity:0.6}),"review");
});
test("lost numeric data or changed pagination prevents delivery",()=>{
  assert.equal(unsafeFidelity(good()),false);
  assert.equal(unsafeFidelity({...good(),numberCoverage:50/51}),true);
  assert.equal(unsafeFidelity({...good(),outputPages:3}),true);
  assert.equal(unsafeFidelity({...good(),textCoverage:0.7}),true);
  assert.equal(unsafeFidelity({...good(),renderedNumberCoverage:0.99}),true);
  assert.equal(fidelityStatus({...good(),numberPrecision:0.99}),"review");
  assert.equal(fidelityStatus({...good(),renderedNumberPrecision:0.99}),"review");
  assert.equal(unsafeFidelity({...good(),renderedTextCoverage:0}),true);
  assert.equal(unsafeFidelity({...good(),sameDimensions:false}),true);
  assert.equal(unsafeFidelity({...good(),visualSimilarity:0.1}),true);
  assert.equal(unsafeFidelity({...good(),worstPageSimilarity:0.1}),true);
});
test("candidate selection prefers preserved numbers and matching pages",()=>{
  assert.ok(fidelityScore(good())>fidelityScore({...good(),numberCoverage:0.5,visualSimilarity:1}));
  assert.ok(fidelityScore(good())>fidelityScore({...good(),outputPages:4,visualSimilarity:1}));
  const complete={...good(),visualSimilarity:0.5,worstPageSimilarity:0.5};
  const missing={...good(),numberCoverage:50/51,visualSimilarity:1,worstPageSimilarity:1};
  assert.equal(betterFidelity(missing,complete),false);
  assert.equal(betterFidelity(complete,missing),true);
});

test("a prettier review cannot replace a candidate that passed every approval requirement",()=>{
  const checked={...good(),visualSimilarity:.91,worstPageSimilarity:.85};
  const review={...good(),renderedTextCoverage:.97,visualSimilarity:1,worstPageSimilarity:1};
  assert.equal(fidelityStatus(checked),"checked");
  assert.equal(betterFidelity(review,checked),false);
  assert.equal(betterFidelity(checked,review),true);
});
