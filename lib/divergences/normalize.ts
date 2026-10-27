export function normalized(value:string){return value.normalize("NFKD").replace(/\p{M}/gu,"").toLowerCase().replace(/\s+/g," ").trim();}
export function decimal(value:string):string|null{
  let text=value.replace(/\u2212/g,"-").replace(/R\$|US\$|EUR|BRL|USD|€|\$/gi,"").replace(/\s/g,"");
  if(!/^[+\-]?\d[\d.,]*$/.test(text))return null;
  const negative=text.startsWith("-");text=text.replace(/^[+\-]/,"");
  const comma=text.lastIndexOf(","),dot=text.lastIndexOf(".");
  let separator="";
  if(comma>=0&&dot>=0)separator=comma>dot?",":".";
  else if(comma>=0)separator=",";
  else if(dot>=0&&text.length-dot-1!==3)separator=".";
  const parts=separator?text.split(separator):[text];
  if(parts.length>2)return null;
  if(separator&&!parts[1])return null;
  if(/[.,]/.test(parts[0])&&!/^\d{1,3}([.,])\d{3}(?:\1\d{3})*$/.test(parts[0]))return null;
  const whole=parts[0].replace(/[.,]/g,"").replace(/^0+(?=\d)/,"");
  const fraction=(parts[1]??"").replace(/0+$/,"");
  if(!/^\d+$/.test(whole)||!/^\d*$/.test(fraction))return null;
  const result=whole+(fraction?"."+fraction:"");
  return negative&&result!=="0"?"-"+result:result;
}
export function dateValue(value:string):string|null{
  const text=value.trim();let year:number,month:number,day:number;
  let match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if(match)[,year,month,day]=match.map(Number);
  else {match=/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/.exec(text);if(!match)return null;day=+match[1];month=+match[2];year=+match[3];}
  const parsed=new Date(Date.UTC(year,month-1,day));
  return year>=1900&&year<=2200&&parsed.getUTCFullYear()===year&&parsed.getUTCMonth()===month-1&&parsed.getUTCDate()===day?`${year}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}`:null;
}
export function similarity(a:string,b:string){const x=new Set(normalized(a).match(/[a-z0-9]+/g)??[]),y=new Set(normalized(b).match(/[a-z0-9]+/g)??[]);const union=new Set([...x,...y]);return union.size?[...x].filter(word=>y.has(word)).length/union.size:1;}
