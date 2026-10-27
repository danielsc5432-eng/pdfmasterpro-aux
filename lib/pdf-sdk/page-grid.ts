import { BorderStyle, Document, HeightRule, LineRuleType, Packer, Paragraph, Table, TableCell, TableLayoutType, TableRow, TabStopType, TextRun, WidthType } from "docx";
import { layoutSections, type LayoutReconstructor } from "../processing/docx";
import { sourceDocument, type SourceSpan } from "./model";
import { fitNativeRun } from "./font-fit";

/** Editable flow rows rather than floating frames. Source artwork remains behind text. */
export async function pageGridSections({pages,assets,artwork}:Parameters<LayoutReconstructor>[0]) {
  const source = sourceDocument(pages.map(page=>({...page,texts:page.texts.filter(item=>(item.rotation??0)===0)})));
  const sections = layoutSections(pages.map(page=>({...page,texts:page.texts.filter(item=>(item.rotation??0)!==0)})),assets,artwork);
  const none={style:BorderStyle.NONE,size:0,color:"FFFFFF"};
  for (const [index,page] of source.pages.entries()) {
    const groups: {y:number;baseline:number;spans:SourceSpan[]}[]=[];
    for (const span of [...page.spans].sort((a,b)=>(a.baseline??a.y+a.height)-(b.baseline??b.y+b.height)||a.x-b.x)) {
      if (![span.x,span.y,span.width,span.height,span.size].every(Number.isFinite) || span.x<0 || span.y<0 || span.x+span.width>page.width+2) throw new Error("Unsupported page geometry");
      const last=groups.at(-1);
      // Mixed font sizes on one physical line have different top coordinates.
      // Group by baseline so labels are not clipped into artificial tiny rows.
      if(last&&Math.abs(last.baseline-(span.baseline??span.y+span.height))<2.5){last.spans.push(span);last.y=Math.min(last.y,span.y);}
      else groups.push({y:span.y,baseline:span.baseline??span.y+span.height,spans:[span]});
    }
    if (!groups.length) continue; // Keep genuine blank pages and their artwork.
    const rows:TableRow[]=[];
    const width=Math.floor(page.width*20)-2;
    const cell=(height:number,paragraph:Paragraph)=>new TableRow({cantSplit:true,height:{value:Math.max(1,Math.round(height*20)),rule:HeightRule.EXACT},children:[new TableCell({width:{size:width,type:WidthType.DXA},margins:{top:0,bottom:0,left:0,right:0},children:[paragraph]})]});
    if(groups[0].y>0.1)rows.push(cell(groups[0].y-0.05,new Paragraph({spacing:{before:0,after:0,line:1,lineRule:LineRuleType.EXACT},children:[new TextRun({text:"",size:2})]})));
    for(const [r,group]of groups.entries()) {
      const spans=[...group.spans].sort((a,b)=>a.x-b.x);
      const height=(groups[r+1]?.y??Math.min(page.height-1,group.y+Math.max(...spans.map(s=>s.height))+3))-group.y;
      if(height<=0)throw new Error("Unsupported row geometry");
      // Staggered columns can have baselines only a few points apart. A flow
      // row that short would clip glyphs; let the page use positioned blocks.
      if(spans.some(span=>span.baseline!==undefined)&&height<Math.max(...spans.map(span=>span.height))*.75)throw new Error("Overlapping native rows require positioned blocks");
      const runs:TextRun[]=[];
      const tabs:{type:typeof TabStopType.LEFT;position:number}[]=[];
      for(const span of spans) {
        if(span.x>0.1){tabs.push({type:TabStopType.LEFT,position:Math.round(span.x*20)});runs.push(new TextRun({text:"\t",size:2}));}
        const native=span.baseline!==undefined;
        const scale=native?await fitNativeRun(span.text,span.font,span.size,span.bold,span.italic,span.width):undefined;
        runs.push(new TextRun({text:span.text,font:span.font,scale,size:Math.max(2,Math.round(span.size*2)),bold:span.bold,italics:span.italic,color:/^#?[0-9a-f]{6}$/i.test(span.color)?span.color.replace("#",""):"000000"}));
        // An explicit small space keeps independent PDF words distinct even
        // when a font substitute leaves too little gap for a PDF extractor.
        if(native)runs.push(new TextRun({text:" ",size:2}));
      }
      rows.push(cell(height,new Paragraph({tabStops:tabs,spacing:{before:0,after:0,line:Math.max(20,Math.round(Math.max(...spans.map(s=>s.height))*20)),lineRule:LineRuleType.EXACT},children:runs})));
    }
    const table=new Table({rows,width:{size:width,type:WidthType.DXA},columnWidths:[width],layout:TableLayoutType.FIXED,margins:{top:0,bottom:0,left:0,right:0},borders:{top:none,bottom:none,left:none,right:none,insideHorizontal:none,insideVertical:none}});
    (sections[index].children as (Paragraph|Table)[]).push(table);
  }
  return sections;
}

export const renderPageGrid: LayoutReconstructor = async context => new Uint8Array(await Packer.toBuffer(new Document({creator:"PDF Master Pro SDK",sections:await pageGridSections(context)})));
