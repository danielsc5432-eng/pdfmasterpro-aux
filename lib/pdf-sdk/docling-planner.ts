import type { LayoutPlanner, ReconstructionPlan, SourceDocument } from "./model";

type Cell = {start_row_offset_idx:number;start_col_offset_idx:number;end_row_offset_idx:number;end_col_offset_idx:number;bbox?:{l:number;t:number;r:number;b:number;coord_origin?:string}};
type DoclingStructure = {tables?:{prov?:{page_no:number}[];data?:{num_rows:number;num_cols:number;table_cells:Cell[]}}[]};

/** Adapt the output of an independently hosted, free Docling model. No API calls here. */
export function doclingTablePlanner(document: DoclingStructure): LayoutPlanner {
  return {name:"docling-table-geometry",async propose(source:SourceDocument,signal:AbortSignal):Promise<ReconstructionPlan>{
    signal.throwIfAborted();
    const tables:ReconstructionPlan["tables"]=[];
    for(const item of document.tables??[]){
      const page=(item.prov?.[0]?.page_no??0)-1, sourcePage=source.pages[page], data=item.data;
      if(!sourcePage||!data||data.num_rows<2||data.num_cols<2||data.num_rows*data.num_cols>20000)continue;
      // Merged cells need a richer model; reject instead of flattening their content incorrectly.
      if(data.table_cells.some(c=>c.end_row_offset_idx-c.start_row_offset_idx!==1||c.end_col_offset_idx-c.start_col_offset_idx!==1))continue;
      const rows=Array.from({length:data.num_rows},()=>Array.from({length:data.num_cols},()=>[] as string[]));
      const seen=new Set<string>();let valid=true;
      for(const cell of data.table_cells){
        const box=cell.bbox, row=cell.start_row_offset_idx,col=cell.start_col_offset_idx;
        if(!box||!rows[row]?.[col]||![box.l,box.t,box.r,box.b].every(Number.isFinite)){valid=false;break;}
        const top=box.coord_origin==="BOTTOMLEFT"?sourcePage.height-box.t:box.t;
        const bottom=box.coord_origin==="BOTTOMLEFT"?sourcePage.height-box.b:box.b;
        for(const span of sourcePage.spans){const cx=span.x+span.width/2,cy=span.y+span.height/2;if(cx>=box.l&&cx<box.r&&cy>=Math.min(top,bottom)&&cy<Math.max(top,bottom)){
          if(seen.has(span.id)){valid=false;break;}seen.add(span.id);rows[row][col].push(span.id);
        }}
      }
      if(valid&&seen.size&&rows.every(row=>row.some(cell=>cell.length)))tables.push({page,rows});
    }
    return {version:1,tables};
  }};
}
