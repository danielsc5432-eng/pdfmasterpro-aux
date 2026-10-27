import test from "node:test";
import assert from "node:assert/strict";
import { testingTaskLimit } from "../../lib/billing/testing-quota";

test("temporary quota requires the matching authenticated email and a future expiry",()=>{
  const previousEmail=process.env.TESTING_QUOTA_EMAIL,previousExpiry=process.env.TESTING_QUOTA_EXPIRES_AT;
  try {
    process.env.TESTING_QUOTA_EMAIL="tester@example.invalid";
    process.env.TESTING_QUOTA_EXPIRES_AT="2026-10-24T12:00:00Z";
    const now=Date.parse("2026-10-23T12:00:00Z");
    assert.equal(testingTaskLimit(null,10,now),10);
    assert.equal(testingTaskLimit("someone@example.invalid",10,now),10);
    assert.equal(testingTaskLimit("TESTER@example.invalid",10,now),100);
    assert.equal(testingTaskLimit("tester@example.invalid",Infinity,now),Infinity);
    assert.equal(testingTaskLimit("tester@example.invalid",10,Date.parse("2026-10-24T12:00:00Z")),10);
    process.env.TESTING_QUOTA_EXPIRES_AT="invalid";
    assert.equal(testingTaskLimit("tester@example.invalid",10,now),10);
    delete process.env.TESTING_QUOTA_EXPIRES_AT;
    assert.equal(testingTaskLimit("tester@example.invalid",10,now),10);
  } finally {
    if(previousEmail===undefined)delete process.env.TESTING_QUOTA_EMAIL;else process.env.TESTING_QUOTA_EMAIL=previousEmail;
    if(previousExpiry===undefined)delete process.env.TESTING_QUOTA_EXPIRES_AT;else process.env.TESTING_QUOTA_EXPIRES_AT=previousExpiry;
  }
});
