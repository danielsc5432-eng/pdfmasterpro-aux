import test from "node:test";
import { renderDirectional } from "../../lib/pdf-sdk/directional";
import { renderAdaptivePages } from "../../lib/pdf-sdk/native";
import assert from "node:assert/strict";
import JSZip from "jszip";
import type { LayoutPage } from "../../lib/processing/layout";
import { createPdfMasterSdk, sourceDocument, validatePlan } from "../../lib/pdf-sdk";
import { renderReconstruction } from "../../lib/pdf-sdk/render";
import { doclingTablePlanner } from "../../lib/pdf-sdk/docling-planner";
import type { FidelityReport } from "../../lib/processing/docx-fidelity";
import { renderPageGrid } from "../../lib/pdf-sdk/page-grid";

const page=():LayoutPage=>({width:400,height:600,images:[],texts:[["Descrição",20,20],["Valor",200,20],["Total",20,60],["1.234,56",200,60]].map(([text,x,y])=>({x:Number(x),y:Number(y),width:80,height:12,words:[{text:String(text),x:Number(x),width:80,bold:false,italic:false}],segments:[{text:String(text),bold:false,italic:false}],font:{family:"Arial",size:10,color:"#000000",bold:false,italic:false}}))});
const proposal=()=>({version:1,tables:[{page:0,rows:[[["p0:l0:w0"],["p0:l1:w0"]],[["p0:l2:w0"],["p0:l3:w0"]]]}]});
const good=():FidelityReport=>({sourcePages:1,outputPages:1,sameDimensions:true,textCoverage:1,numberCoverage:1,numberPrecision:1,renderedNumberCoverage:1,renderedNumberPrecision:1,renderedTextCoverage:1,numberPositionCoverage:1,visualSimilarity:.7,worstPageSimilarity:.6,ocrReview:false});
test("AI plans cannot invent source IDs, duplicate amounts or reverse rows",()=>{
  const source=sourceDocument([page()]);
  const malicious=proposal();malicious.tables[0].rows[1][1]=["made-up-value"];
  assert.throws(()=>validatePlan(source,malicious),/reference/);
  const duplicated=proposal();duplicated.tables[0].rows[0][1]=["p0:l3:w0"];
  assert.throws(()=>validatePlan(source,duplicated),/duplicated/);
  const reversed=proposal();reversed.tables[0].rows.reverse();
  assert.throws(()=>validatePlan(source,reversed),/reverse/);
  const injected={...proposal(),text:"999.999,99"};
  assert.equal("text" in validatePlan(source,injected),false);
});
test("native reconstruction keeps every editable amount exactly once and retains page size",async()=>{
  const output=await renderReconstruction([page()],new Map(),new Map(),proposal());
  const zip=await JSZip.loadAsync(output), xml=await zip.file("word/document.xml")!.async("string");
  assert.equal(xml.match(/1\.234,56/g)?.length,1);
  for(const text of ["Descrição","Valor","Total"])assert.ok(xml.includes(text));
  assert.match(xml,/<w:tbl>/);assert.match(xml,/w:tblpX="400"/);
  assert.match(xml,/w:w="8000"/);assert.match(xml,/w:h="12000"/);
});
test("page grid uses source tab positions and separate font line height, preserving blank pages",async()=>{
  const pages=[page(),{width:400,height:600,texts:[],images:[]}];
  const zip=await JSZip.loadAsync(await renderPageGrid({pages,assets:new Map(),artwork:new Map()}));
  const xml=await zip.file("word/document.xml")!.async("string");
  assert.equal(xml.match(/1\.234,56/g)?.length,1);
  assert.match(xml,/w:pos="4000"/);
  assert.match(xml,/w:line="240"/); // 12pt source line, independent from 40pt gap.
  assert.match(xml,/w:val="800" w:hRule="exact"|w:hRule="exact" w:val="800"/);
  assert.equal(xml.match(/<w:pgSz /g)?.length,2);
  const outside=page();outside.texts[0].words[0].x=-20;
  await assert.rejects(renderPageGrid({pages:[outside],assets:new Map(),artwork:new Map()}),/geometry/);
});
test("mixed font tops on the same baseline do not create clipping rows",async()=>{
  const mixed=page();
  mixed.texts[1].y=22;mixed.texts[1].height=10;mixed.texts[1].font.size=8;
  const zip=await JSZip.loadAsync(await renderPageGrid({pages:[mixed],assets:new Map(),artwork:new Map()}));
  const xml=await zip.file("word/document.xml")!.async("string");
  assert.equal(xml.match(/<w:tr>/g)?.length,3); // Initial whitespace and two physical baselines.
  assert.equal(xml.match(/Valor/g)?.length,1);
  assert.equal(xml.match(/1\.234,56/g)?.length,1);
});
test("landscape dimensions are not swapped a second time by the DOCX library",async()=>{
  const landscape={...page(),width:842,height:595};
  const zip=await JSZip.loadAsync(await renderPageGrid({pages:[landscape],assets:new Map(),artwork:new Map()}));
  const xml=await zip.file("word/document.xml")!.async("string");
  assert.match(xml,/<w:pgSz[^>]*w:w="16840"[^>]*w:h="11900"[^>]*w:orient="landscape"/);
});

test("quarter-turn text remains editable with native Word text direction",async()=>{
  const rotated=page();rotated.texts=rotated.texts.slice(0,1).map(item=>({...item,rotation:90}));
  const zip=await JSZip.loadAsync(await renderDirectional({pages:[rotated],assets:new Map(),artwork:new Map()}));
  const xml=await zip.file("word/document.xml")!.async("string");
  assert.match(xml,/<w:textDirection w:val="tbRl"/);
  assert.equal(xml.match(/Descri/g)?.length,1);
  assert.match(xml,/w:tblpX="400"/);
});

test("mixed documents choose Word flow separately for every page",async()=>{
  const horizontal=page(),vertical=page();
  vertical.texts=vertical.texts.slice(0,1).map(item=>({...item,rotation:90}));
  const zip=await JSZip.loadAsync(await renderAdaptivePages({pages:[horizontal,vertical,{width:400,height:600,texts:[],images:[]}],assets:new Map(),artwork:new Map()}));
  const xml=await zip.file("word/document.xml")!.async("string");
  assert.equal(xml.match(/<w:pgSz /g)?.length,3);
  assert.equal(xml.match(/<w:textDirection /g)?.length,1);
  assert.equal(xml.match(/1\.234,56/g)?.length,1);
  assert.match(xml,/w:pos="4000"/);
});
test("Docling geometry references existing source amounts rather than generating replacements",async()=>{
  const cells=[{l:10,t:10,r:150,b:40},{l:180,t:10,r:300,b:40},{l:10,t:50,r:150,b:80},{l:180,t:50,r:300,b:80}].map((bbox,i)=>({bbox:{...bbox,coord_origin:"TOPLEFT"},start_row_offset_idx:Math.floor(i/2),end_row_offset_idx:Math.floor(i/2)+1,start_col_offset_idx:i%2,end_col_offset_idx:i%2+1}));
  const planner=doclingTablePlanner({tables:[{prov:[{page_no:1}],data:{num_rows:2,num_cols:2,table_cells:cells}}]});
  assert.deepEqual(validatePlan(sourceDocument([page()]),await planner.propose(sourceDocument([page()]),AbortSignal.timeout(1000))),proposal());
});
test("SDK prefers complete content over visually attractive result with missing number",async()=>{
  const sdk=createPdfMasterSdk({engines:[{name:"complete",async convert(){return new Uint8Array([1]);}},{name:"lost-value",async convert(){return new Uint8Array([2]);}}],verify:async(_input,output)=>output[0]===1?good():{...good(),numberCoverage:.5,visualSimilarity:1}});
  const result=await sdk.convert(new TextEncoder().encode("%PDF-1.7"));
  assert.equal(result.engine,"complete");assert.equal(result.audit.length,2);
});
test("SDK blocks measured lost content, continues after engine failure and honours cancellation",async()=>{
  const engines=[{name:"failed",async convert():Promise<Uint8Array>{throw Error("secret internal detail");}},{name:"candidate",async convert(){return new Uint8Array([1]);}}];
  await assert.rejects(createPdfMasterSdk({engines,verify:async()=>({...good(),numberCoverage:.5})}).convert(new TextEncoder().encode("%PDF-1.7")),/bloqueada/);
  await assert.rejects(createPdfMasterSdk({engines,verify:async()=>null}).convert(new TextEncoder().encode("%PDF-1.7")),/bloqueada/);
  const sdk=createPdfMasterSdk({engines,verify:async()=>good()});
  assert.equal((await sdk.convert(new TextEncoder().encode("%PDF-1.7"))).audit[0].outcome,"failed");
  const abort=new AbortController();abort.abort();
  await assert.rejects(sdk.convert(new TextEncoder().encode("%PDF-1.7"),{signal:abort.signal}),{name:"AbortError"});
});
