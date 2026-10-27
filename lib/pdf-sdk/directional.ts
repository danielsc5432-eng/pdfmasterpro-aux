import { BorderStyle, Document, HeightRule, LineRuleType, Packer, Paragraph, Table, TableAnchorType, TableCell, TableLayoutType, TableRow, TextDirection, TextRun, WidthType } from "docx";
import { layoutSections, type LayoutReconstructor } from "../processing/docx";
import { fitNativeRun } from "./font-fit";

/** Independent editable blocks, including quarter-turn text. No raster text substitution. */
export async function directionalSections({pages,assets,artwork}:Parameters<LayoutReconstructor>[0]) {
  const supported=(angle:number)=>[0,90,270].includes(angle);
  const sections=layoutSections(pages.map(page=>({...page,texts:page.texts.filter(item=>!supported(item.rotation??0))})),assets,artwork);
  const none={style:BorderStyle.NONE,size:0,color:"FFFFFF"};
  for(const [index,page] of pages.entries())for(const item of page.texts){
    const angle=item.rotation??0;
    if(!supported(angle))continue; // Oblique stamps retain the conservative positioned fallback.
    if(![item.x,item.y,item.width,item.height,item.font.size].every(Number.isFinite)||item.width<=0||item.height<=0)throw new Error("Invalid block geometry");
    // PDF glyph boxes include ascenders/descenders; Word's vertical line box
    // follows the font size. Retain an explicit leading allowance, then verify.
    const transverse=item.font.size*1.0667;
    const width=Math.max(20,Math.ceil((angle===90||angle===270?transverse:item.width)*20)+8);
    const height=Math.max(20,Math.ceil(item.height*20)+8);
    const text=item.segments.map(segment=>segment.text).join("");
    const scale=await fitNativeRun(text,item.font.family,item.font.size,item.font.bold,item.font.italic,angle===90||angle===270?item.height:item.width);
    const paragraph=new Paragraph({spacing:{before:0,after:0,line:Math.max(20,Math.round(item.font.size*20)),lineRule:LineRuleType.EXACT},children:[new TextRun({text,font:item.font.family,scale,size:Math.max(2,Math.round(item.font.size*2)),bold:item.font.bold,italics:item.font.italic,color:item.font.color.replace("#","")})]});
    const table=new Table({layout:TableLayoutType.FIXED,width:{size:width,type:WidthType.DXA},columnWidths:[width],
      float:{horizontalAnchor:TableAnchorType.PAGE,verticalAnchor:TableAnchorType.PAGE,absoluteHorizontalPosition:Math.round((item.x+(angle===270?Math.max(0,item.width-transverse)*.9:0))*20),absoluteVerticalPosition:Math.round(item.y*20)},
      borders:{top:none,bottom:none,left:none,right:none,insideHorizontal:none,insideVertical:none},
      rows:[new TableRow({cantSplit:true,height:{value:height,rule:HeightRule.EXACT},children:[new TableCell({width:{size:width,type:WidthType.DXA},margins:{top:0,bottom:0,left:0,right:0},textDirection:angle===90?TextDirection.TOP_TO_BOTTOM_RIGHT_TO_LEFT:angle===270?TextDirection.BOTTOM_TO_TOP_LEFT_TO_RIGHT:TextDirection.LEFT_TO_RIGHT_TOP_TO_BOTTOM,children:[paragraph]})]})]});
    (sections[index].children as (Paragraph|Table)[]).push(table);
  }
  return sections;
}

export const renderDirectional: LayoutReconstructor = async context => new Uint8Array(await Packer.toBuffer(new Document({creator:"PDF Master Pro SDK",sections:await directionalSections(context)})));
