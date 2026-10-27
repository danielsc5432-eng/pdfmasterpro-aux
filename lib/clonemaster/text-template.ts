import { LIMITS, type Encoding, type Template, type TemplateField } from "./types";

const cp1252 = new Map<string, number>();
for (let i = 0; i < 256; i++) cp1252.set(new TextDecoder("windows-1252").decode(new Uint8Array([i])), i);
export function encodeText(text: string, encoding: Encoding): Uint8Array {
  if (encoding === "utf-8") return new TextEncoder().encode(text);
  if (encoding === "windows-1252") {
    const bytes: number[] = [];
    for (const character of text) { const code = cp1252.get(character); if (code === undefined) throw Error("O valor contém caracteres não representáveis em Windows-1252. O modelo não foi recodificado."); bytes.push(code); }
    return Uint8Array.from(bytes);
  }
  const bytes = new Uint8Array(text.length * 2), view = new DataView(bytes.buffer);
  for (let i = 0; i < text.length; i++) view.setUint16(i * 2, text.charCodeAt(i), encoding === "utf-16le");
  return bytes;
}

export function readTextTemplate(id: string, name: string, input: Uint8Array, requested: Encoding | "auto" = "auto"): Template {
  const extension = name.split(".").pop()?.toLowerCase() ?? "";
  if (!["txt", "ini", "cfg"].includes(extension)) throw Error("Modelos disponíveis: TXT, INI e CFG com chaves no formato chave=valor.");
  if (!input.length || input.length > LIMITS.templateBytes) throw Error("O modelo deve ter entre 1 byte e 256 KB.");
  let encoding: Encoding = requested === "auto" ? "utf-8" : requested, bomLength = 0;
  if (input[0] === 0xef && input[1] === 0xbb && input[2] === 0xbf) { encoding = "utf-8"; bomLength = 3; }
  else if (input[0] === 0xff && input[1] === 0xfe) { encoding = "utf-16le"; bomLength = 2; }
  else if (input[0] === 0xfe && input[1] === 0xff) { encoding = "utf-16be"; bomLength = 2; }
  let text: string;
  try { text = new TextDecoder(encoding, { fatal: true, ignoreBOM: true }).decode(input.subarray(bomLength)); }
  catch { throw Error("Codificação não reconhecida. Se o arquivo for antigo, selecione Windows-1252 e tente novamente."); }
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text)) throw Error("O modelo contém controles binários ou codificação incompatível.");
  // Verify decoding is reversible, without ever normalizing the original bytes.
  const roundtrip = encodeText(text, encoding), payload = input.subarray(bomLength);
  if (roundtrip.length !== payload.length || roundtrip.some((v, i) => v !== payload[i])) throw Error("Esta codificação não permite preservar todos os bytes do modelo.");
  let section = "", position = 0, lineNumber = 1;
  const fields: TemplateField[] = [], occurrences = new Map<string, number>();
  for (const lineWithBreak of text.match(/[^\r\n]*(?:\r\n|\r|\n|$)/g) ?? []) {
    if (!lineWithBreak) continue;
    const line = lineWithBreak.replace(/[\r\n]+$/, "");
    const heading = line.match(/^[ \t]*\[([^\]\r\n]+)\][ \t]*(?:[;#].*)?$/);
    if (heading) { section = heading[1].trim(); if (section.length > 200) throw Error("Nome de seção excede 200 caracteres."); }
    else if (!/^[ \t]*[;#]/.test(line)) {
      const match = line.match(/^([ \t]*)([^=\r\n]+?)([ \t]*=[ \t]*)(.*)$/);
      if (match) {
        const key = match[2].trim(), rest = match[4];
        if (!key || key.length > 100) throw Error("Chave do modelo vazia ou longa demais.");
        // Inline comments begin only at an unquoted #/; preceded by whitespace.
        let quote = "", commentAt = rest.length;
        for (let i = 0; i < rest.length; i++) {
          if (rest[i] === "\\") { i++; continue; }
          if ((rest[i] === '"' || rest[i] === "'") && (!quote || quote === rest[i])) quote = quote ? "" : rest[i];
          if (!quote && /[;#]/.test(rest[i]) && (i === 0 || /[ \t]/.test(rest[i - 1]))) { commentAt = i; break; }
        }
        const oldValue = rest.slice(0, commentAt).replace(/[ \t]+$/, "");
        // In an empty commented value, the whitespace belongs to the comment
        // separator. Insert before it so the new value cannot swallow a comment.
        const startCharacter = commentAt === 0 && rest.length > 0 ? position + line.indexOf("=") + 1 : position + match[1].length + match[2].length + match[3].length;
        const start = bomLength + encodeText(text.slice(0, startCharacter), encoding).length;
        const identity = section + "\0" + key, occurrence = (occurrences.get(identity) ?? 0) + 1;
        occurrences.set(identity, occurrence);
        fields.push({ id: `field-${fields.length}`, section, key, occurrence, line: lineNumber, start, end: start + encodeText(oldValue, encoding).length, value: oldValue });
        if (fields.length > LIMITS.fields) throw Error("O modelo excede 200 campos editáveis.");
      }
    }
    position += lineWithBreak.length;
    lineNumber++;
  }
  if (!fields.length) throw Error("Nenhuma chave=valor encontrada no modelo. Outros formatos ainda não têm adaptador.");
  return { id, name, extension, bytes: input.slice(), text, encoding, bomLength, fields };
}

export function renderTextTemplate(template: Template, replacements: { field: string; value: string }[]) {
  const used = new Set<string>();
  const edits = replacements.map(replacement => {
    const field = template.fields.find(field => field.id === replacement.field);
    if (!field || used.has(field.id)) throw Error("Campo ausente ou mapeado mais de uma vez.");
    used.add(field.id);
    if (replacement.value.length > 32767 || /[\r\n\x00-\x1f\x7f]/.test(replacement.value)) throw Error("Valor com quebra de linha, controle ou tamanho incompatível com uma chave de configuração.");
    if (/(?:^|[ \t])[;#]/.test(replacement.value)) throw Error("O valor contém um delimitador de comentário que exige revisão do formato do modelo.");
    return { ...field, bytes: encodeText(replacement.value, template.encoding), value: replacement.value };
  }).sort((a, b) => a.start - b.start);
  if (!edits.length) throw Error("Selecione ao menos um campo para substituir.");
  let length = template.bytes.length, cursor = 0;
  for (const edit of edits) { if (edit.start < cursor || edit.end > template.bytes.length) throw Error("Substituições sobrepostas ou inválidas."); cursor = edit.end; length += edit.bytes.length - (edit.end - edit.start); }
  const output = new Uint8Array(length); let sourceOffset = 0, outputOffset = 0;
  for (const edit of edits) { const untouched = template.bytes.subarray(sourceOffset, edit.start); output.set(untouched, outputOffset); outputOffset += untouched.length; output.set(edit.bytes, outputOffset); outputOffset += edit.bytes.length; sourceOffset = edit.end; }
  output.set(template.bytes.subarray(sourceOffset), outputOffset);
  validateOutput(template, output, edits);
  return output;
}

/** Verify every unchanged byte segment independently from the output decoder. */
export function validateOutput(template: Template, output: Uint8Array, edits: { start: number; end: number; bytes: Uint8Array }[]) {
  let sourceOffset = 0, outputOffset = 0;
  for (const edit of edits) {
    for (let i = sourceOffset; i < edit.start; i++) if (output[outputOffset++] !== template.bytes[i]) throw Error("A validação detectou alteração fora dos campos selecionados.");
    for (const byte of edit.bytes) if (output[outputOffset++] !== byte) throw Error("O campo gerado não corresponde ao valor selecionado.");
    sourceOffset = edit.end;
  }
  for (let i = sourceOffset; i < template.bytes.length; i++) if (output[outputOffset++] !== template.bytes[i]) throw Error("A validação detectou alteração no restante do modelo.");
  if (outputOffset !== output.length) throw Error("O resultado contém bytes não previstos.");
}
