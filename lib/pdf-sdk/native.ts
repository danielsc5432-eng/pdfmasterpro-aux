import { layoutSections, pdfToDocx } from "../processing/docx";
import { Document, Packer } from "docx";
import { directionalSections } from "./directional";
import { pageGridSections } from "./page-grid";
import type { LayoutReconstructor } from "../processing/docx";

/** Each page keeps its own renderer, paper size, artwork and reading direction. */
export const renderAdaptivePages:LayoutReconstructor=async({pages,assets,artwork})=>{
  const sections:ReturnType<typeof layoutSections>=[];
  for(const [index,page]of pages.entries()){
    const image=artwork.get(index);
    const context={pages:[page],assets,artwork:image?new Map([[0,image]]):new Map<number,Uint8Array>()};
    if(page.texts.some(item=>[90,270].includes(item.rotation??0)))sections.push(...await directionalSections(context));
    else{
      try{sections.push(...await pageGridSections(context));}
      catch{sections.push(...layoutSections(context.pages,assets,context.artwork));}
    }
  }
  return new Uint8Array(await Packer.toBuffer(new Document({creator:"PDF Master Pro SDK",sections})));
};

/** Extract Unicode geometry independently from Poppler; choose a compatible renderer. */
export function nativePdfToDocx(input:Uint8Array,name:string) {
  return pdfToDocx(input,name,"por+eng",renderAdaptivePages,"native");
}
