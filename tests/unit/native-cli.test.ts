import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { PDFDocument } from "pdf-lib";
import { Document, Packer, Paragraph } from "docx";
import { cliArguments, cliConvert } from "../../lib/processing/cli-engine";
import { withNativeJob } from "../../lib/processing/native-job";

test("CLI templates keep spaces and shell metacharacters inside argv",()=>{
  const input="C:/A folder/$(echo unsafe); input.pdf";
  assert.deepEqual(cliArguments(["--input={input}","{output}"],{input,output:"out.docx"}),[`--input=${input}`,"out.docx"]);
  assert.throws(()=>cliArguments(["{input}"],{input}));
  assert.throws(()=>cliArguments(["{input}","{output}","{unknown}"],{input,output:"out"}));
});

test("native jobs clean temporary files after failures and reject overlapping jobs",async()=>{
  let directory="",release!:()=>void,entered!:()=>void;
  const started=new Promise<void>(resolve=>{entered=resolve;});
  const barrier=new Promise<void>(resolve=>{release=resolve;});
  const first=withNativeJob(new Uint8Array([7]),"pdf",async job=>{directory=job.directory;assert.deepEqual([...await readFile(job.inputPath)],[7]);entered();await barrier;});
  await started;
  try{await assert.rejects(withNativeJob(new Uint8Array([1]),"pdf",async()=>0),/ocupado/);}finally{release();await first;}
  await assert.rejects(access(directory));
  await assert.rejects(withNativeJob(new Uint8Array([1]),"pdf",async job=>{directory=job.directory;throw Error("test failure");}),/test failure/);
  await assert.rejects(access(directory));
});

test("configured CLI executes a real child process and validates its PDF output",async()=>{
  const savedExecutable=process.env.WORD_TO_PDF_CLI_EXECUTABLE,savedArgs=process.env.WORD_TO_PDF_CLI_ARGS;
  const document=await PDFDocument.create();document.addPage([400,600]);
  const payload=Buffer.from(await document.save()).toString("base64");
  const word=new Uint8Array(await Packer.toBuffer(new Document({sections:[{children:[new Paragraph("CLI fixture")]}]})));
  try{
    process.env.WORD_TO_PDF_CLI_EXECUTABLE=process.execPath;
    process.env.WORD_TO_PDF_CLI_ARGS=JSON.stringify(["-e","require('node:fs').writeFileSync(process.argv[1],Buffer.from(process.argv[2],'base64'))","{output}",payload,"{input}"]);
    assert.equal((await PDFDocument.load(await cliConvert("word-to-pdf",word,10000))).getPageCount(),1);
    process.env.WORD_TO_PDF_CLI_ARGS=JSON.stringify(["-e","require('node:fs').writeFileSync(process.argv[1],'bad')","{output}","{input}"]);
    await assert.rejects(cliConvert("word-to-pdf",word,10000));
  }finally{
    if(savedExecutable===undefined)delete process.env.WORD_TO_PDF_CLI_EXECUTABLE;else process.env.WORD_TO_PDF_CLI_EXECUTABLE=savedExecutable;
    if(savedArgs===undefined)delete process.env.WORD_TO_PDF_CLI_ARGS;else process.env.WORD_TO_PDF_CLI_ARGS=savedArgs;
  }
});
