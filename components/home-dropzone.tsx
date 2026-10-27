"use client";

import { FileUp, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { queueFiles } from "@/lib/pending-files";
import { DragEvent, useRef, useState } from "react";

export function HomeDropzone() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const names = files.map((file) => file.name);
  const target = files.length && files.every((file) => /\.(png|jpe?g)$/i.test(file.name)) ? "imagens-para-pdf" : files.length && /\.docx?$/i.test(files[0].name) ? "word-para-pdf" : "juntar-pdf";
  const [dragging, setDragging] = useState(false);
  function accept(files: FileList | null) { if (files) setFiles(Array.from(files).slice(0, 5)); }
  function onDrop(event: DragEvent<HTMLDivElement>) { event.preventDefault(); setDragging(false); accept(event.dataTransfer.files); }
  return <div className="upload-card"><div className="upload-card-top"><span className="upload-card-title">Comece com seus arquivos</span><span className="upload-card-badge">Seleção local</span></div><div className={`dropzone ${dragging ? "dragging" : ""}`} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop} onClick={() => inputRef.current?.click()} role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); inputRef.current?.click(); } }}><input ref={inputRef} className="file-input" type="file" multiple accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" onChange={(event) => accept(event.target.files)} /><span className="dropzone-icon"><FileUp size={25} /></span>{names.length === 0 ? <><strong>Arraste ou escolha um arquivo</strong><span>PDF, documentos Word e imagens JPG ou PNG</span></> : <><strong>{names.length} arquivo(s) selecionado(s)</strong><span>{names.slice(0, 2).join(", ")}{names.length > 2 ? "…" : ""}</span></>}</div>{names.length > 0 && <div style={{ marginTop: 15, display: "flex", gap: 9, alignItems: "center", justifyContent: "space-between" }}><span style={{ color: "var(--muted)", fontSize: 12 }}>Seleção local concluída. Escolha um fluxo para enviar.</span><Link className="button button-primary" href={"/ferramentas/" + target} onClick={(event) => { event.stopPropagation(); queueFiles(files); }}>Continuar</Link></div>}<div className="hero-note"><ShieldCheck size={14} /> Nenhum arquivo é enviado nesta área de descoberta.</div></div>;
}
