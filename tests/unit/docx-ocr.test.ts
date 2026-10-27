import test from "node:test";
import assert from "node:assert/strict";
import { PNG } from "pngjs";
import { betterOcrCandidate, restoreOcrCoordinates, eraseRecognizedInk, needsPageOcr, ocrPageLayout, parseOcrTsv } from "../../lib/processing/docx-ocr";
import type { LayoutPage } from "../../lib/processing/layout";

test("deskew restores all bounding corners to source coordinates",()=>{
  const word={text:"-123,45",x:10,y:20,width:30,height:5,confidence:80,line:"1"};
  const [mapped]=restoreOcrCoordinates([word],[[0,-1,100],[1,0,0]]);
  assert.deepEqual([mapped.x,mapped.y,mapped.width,mapped.height],[75,10,5,30]);
  assert.throws(()=>restoreOcrCoordinates([word],[[NaN,0,0],[0,1,0]]));
});
test("higher OCR confidence cannot silently change or drop numbers",()=>{
  const word={text:"-123,45",x:0,y:0,width:30,height:5,confidence:60,line:"1"};
  assert.equal(betterOcrCandidate([word],[{...word,confidence:95}]),true);
  assert.equal(betterOcrCandidate([word],[{...word,text:"123,45",confidence:99}]),false);
  assert.equal(betterOcrCandidate([word],[]),false);
});

test("OCR TSV preserves recognized decimals and excludes malformed boxes",()=>{
  const words=parseOcrTsv("level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n5\t1\t1\t1\t1\t1\t100\t200\t80\t30\t89.5\t1.234,56\n5\t1\t1\t1\t1\t2\t-1\t200\t80\t30\t89\tbad\n");
  assert.equal(words.length,1); assert.equal(words[0].text,"1.234,56");
  const items=ocrPageLayout(words,600,800,2500,3333);
  assert.equal(items[0].words[0].x,24); assert.equal(items[0].segments[0].text,"1.234,56");
});
test("OCR is selected for scanned pages, not logos or native text",()=>{
  const page:LayoutPage={width:600,height:800,texts:[],images:[{x:0,y:0,width:600,height:800,source:"scan.png"}]};
  assert.equal(needsPageOcr(page),true);
  assert.equal(needsPageOcr({...page,images:[{x:0,y:0,width:60,height:50,source:"logo.png"}]}),false);
  assert.equal(needsPageOcr({...page,texts:[{words:Array(9).fill({text:"native"})} as never]}),false);
});
test("recognized scanned ink is removed before editable text is overlaid",()=>{
  const png=new PNG({width:10,height:10});png.data.fill(100);
  eraseRecognizedInk(png,[{text:"123",x:4,y:4,width:2,height:2,confidence:90,line:"1"}]);
  assert.equal(png.data[(4*10+4)*4+3],0);
  assert.equal(png.data[3],100,"unrecognized artwork is preserved");
});
