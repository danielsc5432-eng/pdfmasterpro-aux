import { PDFDocument, StandardFonts, type PDFFont } from "pdf-lib";

const metrics=new Map<string,Promise<PDFFont>>();
/** Horizontal scale against the PDF advance, without changing text or values. */
export async function fitNativeRun(text:string,font:string,size:number,bold:boolean,italic:boolean,advance:number):Promise<number|undefined>{
  const family=/^Arial$/i.test(font)?"Helvetica":/^Times New Roman$/i.test(font)?"TimesRoman":/^Courier New$/i.test(font)?"Courier":null;
  if(!family||!Number.isFinite(advance)||advance<=0)return undefined;
  const key=(family+(bold?(italic?"BoldOblique":"Bold"):italic?"Oblique":"")) as keyof typeof StandardFonts;
  const actual=family==="TimesRoman"?(bold?(italic?StandardFonts.TimesRomanBoldItalic:StandardFonts.TimesRomanBold):italic?StandardFonts.TimesRomanItalic:StandardFonts.TimesRoman):StandardFonts[key];
  if(!actual)return undefined;
  let cached=metrics.get(actual);
  if(!cached){cached=PDFDocument.create().then(doc=>doc.embedFont(actual));metrics.set(actual,cached);}
  try{
    const measured=(await cached).widthOfTextAtSize(text,Math.max(1,Math.round(size*2)/2));
    const percent=Math.round(advance/measured*100);
    return Number.isFinite(percent)&&percent>=50&&percent<=200?percent:undefined;
  }catch{return undefined;} // CJK glyphs are measured by the installed CJK font, not Latin metrics.
}
