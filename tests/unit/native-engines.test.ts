import test from 'node:test';
import assert from 'node:assert/strict';
import {engineEnvironment,validateEngineInput} from '../../lib/processing/native-engines';
import {ocrEngineArguments} from '../../lib/processing/smart-ocr';
test('native subprocesses do not inherit application credentials',()=>{
 const key='PDFMASTER_SYNTHETIC_SECRET';process.env[key]='test';
 try{const env=engineEnvironment('test-temp');assert.equal(env[key],undefined);assert.equal(env.TMPDIR,'test-temp');assert.equal(env.OMP_THREAD_LIMIT,'1');}finally{delete process.env[key];}
});
test('OCR rejects language option injection and uses rotation recovery only when needed',()=>{
 const info={rich:false,pages:[{number:1,width:100,height:100,text:'',needsOcr:true,rotation:0}]};
 assert.throws(()=>ocrEngineArguments(info,'--force-ocr','in','out'));
 assert.ok(ocrEngineArguments(info,'por+eng','in','out').includes('pypdfium'));
 info.pages[0].rotation=90;assert.ok(ocrEngineArguments(info,'por','in','out').includes('--rotate-pages'));
});
test('native upload boundary rejects empty and oversized files before execution',()=>{
 assert.throws(()=>validateEngineInput(new Uint8Array()));
 const large=new Uint8Array(25*1024*1024+1);large.set(new TextEncoder().encode('%PDF-'));assert.throws(()=>validateEngineInput(large));
});
