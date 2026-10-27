import test from "node:test";
import assert from "node:assert/strict";
import { addBillingMonths } from "../../lib/billing/period";

test("prazo mensal não salta fevereiro quando aprovado em 31 de janeiro", () => {
  assert.equal(addBillingMonths(new Date("2027-01-31T12:30:00Z"), 1).toISOString(), "2027-02-28T12:30:00.000Z");
  assert.equal(addBillingMonths(new Date("2028-01-31T12:30:00Z"), 1).toISOString(), "2028-02-29T12:30:00.000Z");
});
test("prazo anual preserva horário e limita 29 de fevereiro ao fim do mês", () => {
  assert.equal(addBillingMonths(new Date("2028-02-29T12:30:00Z"), 12).toISOString(), "2029-02-28T12:30:00.000Z");
});
