"use client";
import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { loadLegalPdf } from "@/lib/legal/pdf";
import { LEGAL_LIMITS, type LegalEvidence } from "@/lib/legal/types";

export function LegalDocumentViewer({ file, page, setPage, pages, evidence, sync, onScroll, title, zoom }: {file:File;page:number;setPage:(page:number)=>void;pages:number;evidence?:LegalEvidence;sync?:React.RefObject<HTMLDivElement|null>;onScroll?:()=>void;title:string;zoom:number}) {
  const canvas=useRef<HTMLCanvasElement>(null),host=useRef<HTMLDivElement>(null),proxy=useRef<PDFDocumentProxy|null>(null);
  const [loaded,setLoaded]=useState(0),[error,setError]=useState(""),[dimensions,setDimensions]=useState({width:1,height:1,scale:1}),[hostWidth,setHostWidth]=useState(0),[rendered,setRendered]=useState(false);
  useEffect(()=>{const element=host.current;if(!element)return;const observer=new ResizeObserver(()=>setHostWidth(Math.round(element.getBoundingClientRect().width)));observer.observe(element);return()=>observer.disconnect();},[]);
  useEffect(()=>{
    const controller=new AbortController();let cleanup:(()=>void)|null=null;
    setLoaded(0);setRendered(false);setError("");
    void (async()=>{try{const {task,document}=await loadLegalPdf(new Uint8Array(await file.arrayBuffer()),controller.signal);cleanup=()=>{void task.destroy();};if(controller.signal.aborted){cleanup();return;}proxy.current=document;setLoaded(Date.now());}catch(reason){if(!controller.signal.aborted)setError(reason instanceof Error?reason.message:"Não foi possível abrir a página.");}})();
    return()=>{controller.abort();proxy.current=null;cleanup?.();};
  },[file]);
  useEffect(()=>{
    let task:ReturnType<Awaited<ReturnType<PDFDocumentProxy["getPage"]>>["render"]>|null=null;let cancelled=false;
    if(!loaded||!proxy.current||!canvas.current)return;
    setError("");setRendered(false);
    void(async()=>{try{
      const source=await proxy.current!.getPage(Math.min(pages,Math.max(1,page)));if(cancelled||!canvas.current)return;
      const original=source.getViewport({scale:1});const scale=Math.min((Math.max(240,hostWidth||400)-44)/original.width*zoom,Math.sqrt(LEGAL_LIMITS.pixels/(original.width*original.height))*.99);
      const viewport=source.getViewport({scale}),target=canvas.current;target.width=Math.ceil(viewport.width);target.height=Math.ceil(viewport.height);setDimensions({width:viewport.width,height:viewport.height,scale});
      task=source.render({canvas:target,canvasContext:target.getContext("2d")!,viewport,annotationMode:1});await task.promise;if(!cancelled)setRendered(true);
    }catch(reason){if(!cancelled)setError(reason instanceof Error?reason.message:"Falha na renderização.");}})();
    return()=>{cancelled=true;task?.cancel();};
  },[loaded,page,pages,zoom,hostWidth]);
  return <section className="legal-viewer" aria-label={title}><div className="legal-viewer-heading"><strong>{title}</strong><span title={file.name}>{file.name}</span></div><div className="legal-page-controls"><button type="button" className="button button-ghost" disabled={page<=1} onClick={()=>setPage(page-1)} aria-label={`Página anterior de ${title}`}>←</button><label>Página <input type="number" min="1" max={pages} value={page} onChange={event=>setPage(Math.max(1,Math.min(pages,Number(event.target.value)||1)))} /> de {pages}</label><button type="button" className="button button-ghost" disabled={page>=pages} onClick={()=>setPage(page+1)} aria-label={`Próxima página de ${title}`}>→</button></div><div className="legal-canvas-scroll" ref={element=>{host.current=element;if(sync)sync.current=element;}} onScroll={onScroll}><div className="legal-canvas-layer" style={{width:dimensions.width,height:dimensions.height}}><canvas ref={canvas} data-legal-rendered={rendered?"true":"false"} style={{opacity:rendered?1:0}} aria-label={`${title}, página ${page}`} />{rendered&&evidence?.page===page&&<div className="legal-highlight" aria-label="Região da alteração selecionada" style={{left:evidence.box[0]*dimensions.scale,top:evidence.box[1]*dimensions.scale,width:Math.max(4,(evidence.box[2]-evidence.box[0])*dimensions.scale),height:Math.max(4,(evidence.box[3]-evidence.box[1])*dimensions.scale)}}><span>Alteração</span></div>}</div>{!rendered&&!error&&<p role="status">Carregando página local…</p>}{error&&<p role="alert">{error}</p>}</div></section>;
}
