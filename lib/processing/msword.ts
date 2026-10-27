import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import JSZip from "jszip";
import { PDFDocument } from "pdf-lib";

const run = promisify(execFileCallback);

const PROBE = "if ($null -eq [type]::GetTypeFromProgID('Word.Application')) { 'NO' } else { 'YES' }";

// O Word exibe um aviso de conversão de PDF ("Agora o Word converterá o PDF...") que é hospedado
// no processo PDFREFLOW e NÃO é suprimido por DisplayAlerts. Sem o clique em "OK", a automação
// trava para sempre. O script embute um vigia que detecta o diálogo (janelas #32770 dos processos
// WINWORD/PDFREFLOW criados por esta conversão) e o fecha sozinho, marcando "não exibir novamente".
const CONVERT = `param(
  [Parameter(Mandatory = $true)][string]$InputPath,
  [Parameter(Mandatory = $true)][string]$OutputPath,
  [Parameter(Mandatory = $true)][ValidateSet("docx", "pdf")][string]$Action
)
$ErrorActionPreference = "Stop"
$since = Get-Date

Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public static class PdfMasterWordDialogs {
  delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);

  [DllImport("user32.dll", CharSet = CharSet.Unicode, ExactSpelling = true)] static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll", CharSet = CharSet.Unicode, ExactSpelling = true)] static extern bool EnumChildWindows(IntPtr parent, EnumProc cb, IntPtr l);
  [DllImport("user32.dll", CharSet = CharSet.Unicode, ExactSpelling = true)] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet = CharSet.Unicode, ExactSpelling = true)] static extern int GetClassNameW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode, ExactSpelling = true)] static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode, ExactSpelling = true)] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode, ExactSpelling = true)] static extern IntPtr SendMessageW(IntPtr h, uint msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll", CharSet = CharSet.Unicode, ExactSpelling = true)] static extern int GetWindowLongW(IntPtr h, int index);

  const uint BM_GETCHECK = 0x00F0;
  const uint BM_CLICK = 0x00F5;
  const int GWL_STYLE = -16;

  static List<IntPtr> DialogsOf(uint[] pids) {
    var set = new HashSet<uint>(pids);
    var found = new List<IntPtr>();
    EnumProc enumTop = delegate(IntPtr h, IntPtr l) {
      uint pid; GetWindowThreadProcessId(h, out pid);
      if (set.Contains(pid)) {
        var cls = new StringBuilder(64); GetClassNameW(h, cls, 64);
        if (cls.ToString() == "#32770") found.Add(h);
      }
      return true;
    };
    EnumWindows(enumTop, IntPtr.Zero);
    GC.KeepAlive(enumTop);
    return found;
  }

  public static int Dismiss(uint[] pids) {
    int acted = 0;
    foreach (var dialog in DialogsOf(pids)) {
      IntPtr check = IntPtr.Zero;
      IntPtr ok = IntPtr.Zero;
      EnumProc enumChild = delegate(IntPtr h, IntPtr l) {
        var cls = new StringBuilder(64); GetClassNameW(h, cls, 64);
        if (cls.ToString() != "Button") return true;
        int style = GetWindowLongW(h, GWL_STYLE) & 0x0F;
        if (style == 2 || style == 3) {                 // BS_CHECKBOX / BS_AUTOCHECKBOX
          if (check == IntPtr.Zero) check = h;
        } else if (style == 0 || style == 1) {          // BS_PUSHBUTTON / BS_DEFPUSHBUTTON
          var text = new StringBuilder(64); GetWindowTextW(h, text, 64);
          if (ok == IntPtr.Zero && string.Equals(text.ToString().Trim(), "OK", StringComparison.OrdinalIgnoreCase)) ok = h;
        }
        return true;
      };
      EnumChildWindows(dialog, enumChild, IntPtr.Zero);
      GC.KeepAlive(enumChild);

      if (check != IntPtr.Zero) {
        long state = SendMessageW(check, BM_GETCHECK, IntPtr.Zero, IntPtr.Zero).ToInt64();
        if (state != 1) { SendMessageW(check, BM_CLICK, IntPtr.Zero, IntPtr.Zero); acted++; }
      }
      if (ok != IntPtr.Zero) { SendMessageW(ok, BM_CLICK, IntPtr.Zero, IntPtr.Zero); acted++; }
    }
    return acted;
  }
}
"@

$watch = [hashtable]::Synchronized(@{ Stop = $false; Since = $since })
$watchRunspace = [runspacefactory]::CreateRunspace()
$watchRunspace.Open()
$watchPs = [powershell]::Create()
$watchPs.Runspace = $watchRunspace
[void]$watchPs.AddScript({
    param($state)
    while (-not $state.Stop) {
      try {
        $targets = @()
        foreach ($name in "WINWORD", "PDFREFLOW") {
          $targets += Get-Process $name -ErrorAction SilentlyContinue | Where-Object { $_.StartTime -ge $state.Since } | ForEach-Object { [uint32]$_.Id }
        }
        if ($targets.Count -gt 0) { [PdfMasterWordDialogs]::Dismiss($targets) | Out-Null }
      } catch {}
      Start-Sleep -Milliseconds 300
    }
  }).AddArgument($watch)
$watchHandle = $watchPs.BeginInvoke()

$word = $null
$doc = $null
try {
  $word = New-Object -ComObject Word.Application
  $word.Visible = $false
  $word.DisplayAlerts = 0
  try { $word.AutomationSecurity = 3 } catch {}
  try { $word.Options.ConfirmConversions = $false } catch {}
  try { $word.Options.SaveNormalPrompt = $false } catch {}
  $doc = $word.Documents.Open($InputPath, $false, $false, $false)
  if ($Action -eq "docx") { $doc.SaveAs2($OutputPath, 16) } else { $doc.ExportAsFixedFormat($OutputPath, 17) }
  $doc.Close($false)
  $doc = $null
} finally {
  if ($null -ne $doc) { try { $doc.Close($false) } catch {} }
  if ($null -ne $word) { try { $word.Quit() } catch {} }
  try { $watch.Stop = $true } catch {}
  try { Start-Sleep -Milliseconds 500; $watchPs.Stop(); $watchPs.Dispose() } catch {}
  try { $watchRunspace.Close() } catch {}
}
if (-not (Test-Path $OutputPath)) { exit 1 }
`;

const TIMEOUT_MS = Number(process.env.MSWORD_TIMEOUT_MS || 240000);

let availability: boolean | undefined;
let queue: Promise<unknown> = Promise.resolve();

function serialize<T>(task: () => Promise<T>): Promise<T> {
  const result = queue.then(task, task);
  queue = result.then(() => undefined, () => undefined);
  return result;
}

async function isWordAvailable(): Promise<boolean> {
  if (availability !== undefined) return availability;
  if (process.platform !== "win32") {
    availability = false;
    return false;
  }
  try {
    const { stdout } = await run("powershell", ["-NoProfile", "-NonInteractive", "-Command", PROBE], { timeout: 20000, windowsHide: true });
    availability = stdout.includes("YES");
  } catch {
    availability = false;
  }
  return availability;
}

// Encerra apenas instâncias criadas por esta conversão que sobraram (timeout/travamento).
async function killOrphanOffice(since: Date) {
  const marker = since.toISOString();
  const script = `
    foreach ($name in "WINWORD", "PDFREFLOW") {
      Get-Process $name -ErrorAction SilentlyContinue |
        Where-Object { $_.StartTime -gt ([datetime]'${marker}') -and ($name -eq "PDFREFLOW" -or $_.MainWindowHandle -eq 0) } |
        Stop-Process -Force -ErrorAction SilentlyContinue
    }`;
  await run("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], { timeout: 20000, windowsHide: true });
}

const TWIPS_PER_POINT = 20;

/** Tamanhos (em twips) de todas as páginas do PDF original, ou null quando ilegível. */
async function readPdfPageSizesInTwips(input: Uint8Array): Promise<{ width: number; height: number }[] | null> {
  try {
    const doc = await PDFDocument.load(input, { ignoreEncryption: true });
    const sizes = doc.getPages().map((page) => {
      const { width, height } = page.getSize();
      // Páginas rotacionadas são exibidas com largura/altura trocadas; o Word reflow segue a visão.
      const rotated = Math.abs(page.getRotation().angle % 180) === 90;
      return {
        width: Math.round((rotated ? height : width) * TWIPS_PER_POINT),
        height: Math.round((rotated ? width : height) * TWIPS_PER_POINT),
      };
    });
    return sizes.length && sizes.every((size) => size.width > 0 && size.height > 0) ? sizes : null;
  } catch {
    return null;
  }
}

/**
 * O PDF Reflow do Word grava no DOCX o tamanho de página padrão (A4/Letter) e margens derivadas
 * do conteúdo (ex.: margem inferior de ~500pt), o que encolhe a área de texto e empurra conteúdo
 * para páginas extras — PDF de 2 páginas sai com 3. Este ajuste devolve ao DOCX, seção por seção,
 * o tamanho exato da página correspondente do PDF original (PDFs podem ter páginas de tamanhos
 * diferentes) e zera a margem inferior, que não ancora conteúdo e só limita onde o Word quebra a
 * página — preservando a âncora visual do texto (topo/laterais intactos) e a contagem de páginas.
 */
export async function fitDocxToPdfPage(docx: Uint8Array, pdf: Uint8Array): Promise<Uint8Array> {
  const sizes = await readPdfPageSizesInTwips(pdf);
  if (!sizes?.length) return docx;
  const zip = await JSZip.loadAsync(docx).catch(() => null);
  const documentXml = zip?.file("word/document.xml");
  if (!zip || !documentXml) return docx;
  let xml = await documentXml.async("string");

  // Um sectPr por seção, em ordem do documento (o primeiro encerra a seção 1; o último, no body,
  // é a seção final). Quando o Word gera uma seção por página, o mapa é página a página; quando
  // ele funde páginas de mesmo tamanho em uma seção, o mapa usa os blocos de tamanhos consecutivos.
  const sections = xml.match(/<w:sectPr[\s\S]*?<\/w:sectPr>/g) || [];
  if (!sections.length) return docx;
  const runs = sizes.filter((size, index) => index === 0 || size.width !== sizes[index - 1].width || size.height !== sizes[index - 1].height);
  const mapping = sections.length === sizes.length ? sizes : sections.length === runs.length ? runs : sizes;

  let index = 0;
  xml = xml.replace(/<w:sectPr[\s\S]*?<\/w:sectPr>/g, (block) => {
    const size = mapping[Math.min(index, mapping.length - 1)];
    index++;
    const landscape = size.width > size.height;
    const pgSz = `<w:pgSz w:w="${size.width}" w:h="${size.height}"${landscape ? ' w:orient="landscape"' : ""}/>`;
    let next = /<w:pgSz[\s>]/.test(block)
      ? block.replace(/<w:pgSz[^>]*\/>/g, pgSz)
      : block.replace(/(<w:sectPr[^>]*>)/, `$1${pgSz}`);
    // Margem inferior zerada: ela não ancora conteúdo (o texto flui do topo/laterais, já preservados)
    // e só define onde o Word força a quebra — zerada, ela dá espaço máximo para o conteúdo da página
    // original caber na mesma página, sem mover nada visualmente.
    next = next.replace(/<w:pgMar[^>]*\/>/g, (tag) => tag.replace(/w:bottom="\d+"/, 'w:bottom="0"'));
    return next;
  });

  zip.file("word/document.xml", xml);
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

async function convertWithWord(input: Uint8Array, extension: string, action: "docx" | "pdf"): Promise<Uint8Array> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pdfmaster-msword-"));
  const startedAt = new Date();
  try {
    const inputPath = path.join(directory, `input.${extension}`);
    const outputPath = path.join(directory, action === "docx" ? "output.docx" : "output.pdf");
    const scriptPath = path.join(directory, "convert.ps1");
    await writeFile(inputPath, input);
    await writeFile(scriptPath, CONVERT, "utf8");
    await run(
      "powershell",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptPath, "-InputPath", inputPath, "-OutputPath", outputPath, "-Action", action],
      { timeout: TIMEOUT_MS, windowsHide: true },
    );
    const bytes = await readFile(outputPath);
    if (bytes.length < 100) throw new Error("O Microsoft Word retornou um arquivo vazio.");
    const output = new Uint8Array(bytes);
    return action === "docx" ? await fitDocxToPdfPage(output, input) : output;
  } catch (error) {
    await killOrphanOffice(startedAt).catch(() => undefined);
    throw error;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function engineEnabled(name: string, expected: string) {
  const value = (process.env[name] || "").trim().toLowerCase();
  return !value || value === expected;
}

/** Converte PDF em DOCX usando o próprio Microsoft Word (PDF Reflow). Devolve null quando indisponível. */
export async function pdfToDocxWithMsWord(input: Uint8Array): Promise<Uint8Array | null> {
  if (!engineEnabled("PDF_TO_WORD_CONVERTER", "msword")) return null;
  if (!(await isWordAvailable())) return null;
  try {
    return await serialize(() => convertWithWord(input, "pdf", "docx"));
  } catch {
    return null;
  }
}

/** Converte DOCX/DOC em PDF pelo Microsoft Word. Devolve null quando indisponível. */
export async function docxToPdfWithMsWord(input: Uint8Array, originalName: string): Promise<Uint8Array | null> {
  if (!engineEnabled("WORD_CONVERTER", "msword")) return null;
  if (!(await isWordAvailable())) return null;
  const extension = originalName.toLowerCase().endsWith(".doc") ? "doc" : "docx";
  try {
    return await serialize(() => convertWithWord(input, extension, "pdf"));
  } catch {
    return null;
  }
}
