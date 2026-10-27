import test from "node:test";
import assert from "node:assert/strict";
import {processingWorkerUrl, workerAcceptsTool, workerRequestLimit, workerRequestHeaders, workerResponseHeaders} from "../../lib/processing/worker-routing";

const env = {NODE_ENV:"production",PROCESSING_WORKER_URL:"https://main.example/",PROCESSING_WORKER_ROUTES:JSON.stringify({"girar-pdf":{url:"https://aux.example/",maxRequestBytes:8388608}})};
test("small allowlisted tasks select auxiliary; large or unknown uploads stay on main",()=>{
  assert.equal(processingWorkerUrl("girar-pdf",1000,env),"https://aux.example");
  for(const size of [undefined,0,-1,Infinity,9000000])assert.equal(processingWorkerUrl("girar-pdf",size,env),"https://main.example");
  assert.equal(processingWorkerUrl("ocr-pdf",1000,env),"https://main.example");
});
test("worker cannot proxy again even when frontend settings are accidentally copied",()=>{
  assert.equal(processingWorkerUrl("girar-pdf",1000,{...env,PROCESSING_WORKER_ONLY:"1"}),undefined);
});
test("malformed and credential-bearing destinations fail closed",()=>{
  for(const url of ["http://other.example","https://user:password@other.example","https://other.example/path","https://other.example/?key=secret"]){
    assert.throws(()=>processingWorkerUrl("girar-pdf",1000,{...env,PROCESSING_WORKER_ROUTES:JSON.stringify({"girar-pdf":{url}})}));
  }
  assert.throws(()=>processingWorkerUrl("girar-pdf",1,{...env,PROCESSING_WORKER_ROUTES:'{"unknown":{"url":"https://aux.example"}}'}));
  assert.throws(()=>processingWorkerUrl("girar-pdf",1,{...env,PROCESSING_WORKER_ROUTES:"not json"}));
});
test("bounded routes require a fallback for uploads that do not fit",()=>{
  assert.throws(()=>processingWorkerUrl("girar-pdf",9000000,{...env,PROCESSING_WORKER_URL:undefined}));
});
test("legacy single-worker deployment keeps its destination",()=>{
  assert.equal(processingWorkerUrl("ocr-pdf",10,{PROCESSING_WORKER_URL:"https://main.example/"}),"https://main.example");
  assert.equal(processingWorkerUrl("girar-pdf",10,{}),undefined);
});
test("auxiliary accepts only its tools and validates its upload ceiling",()=>{
  const worker={PROCESSING_WORKER_ONLY:"1",PROCESSING_WORKER_TOOLS:"girar-pdf,dividir-pdf"};
  assert.equal(workerAcceptsTool("girar-pdf",worker),true);assert.equal(workerAcceptsTool("ocr-pdf",worker),false);
  assert.equal(workerRequestLimit({PROCESSING_WORKER_MAX_REQUEST_BYTES:"8388608"}),8388608);
  assert.throws(()=>workerRequestLimit({PROCESSING_WORKER_MAX_REQUEST_BYTES:"NaN"}));
});
test("forwarding strips personal cookies and caller authorization while preserving multipart boundaries",()=>{
  const headers=workerRequestHeaders(new Headers({cookie:"personal-session",authorization:"Bearer personal",host:"frontend.example","content-type":"multipart/form-data; boundary=synthetic","x-pdfmaster-plan":"forged"}),{"x-pdfmaster-plan":"signed","x-pdfmaster-plan-sig":"signature"});
  assert.equal(headers.get("cookie"),null);assert.equal(headers.get("authorization"),null);assert.equal(headers.get("host"),null);
  assert.equal(headers.get("x-pdfmaster-plan"),"signed");assert.equal(headers.get("content-type"),"multipart/form-data; boundary=synthetic");
  assert.throws(()=>workerRequestHeaders(new Headers(),null));
});
test("a worker cannot overwrite the frontend session or expose stale compression headers",()=>{
  const headers=workerResponseHeaders(new Headers({"set-cookie":"pdfmaster_session=worker-session","content-length":"100","content-encoding":"gzip","transfer-encoding":"chunked","content-disposition":"attachment; filename=result.pdf"}));
  for(const key of ["set-cookie","content-length","content-encoding","transfer-encoding"])assert.equal(headers.get(key),null);
  assert.equal(headers.get("content-disposition"),"attachment; filename=result.pdf");
});
