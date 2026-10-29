/* G10 右键菜单系统桥：Windows 原生剪贴板/打开方式（PowerShell -EncodedCommand 防中文路径 GBK 损坏）。
   VSCode API 剪贴板只有文本（readText/writeText）——文件列表（CF_HDROP）与位图必须走 PowerShell。
   全部为纯函数 + run 助手；平台限定 win32（其他平台返回 no-op 承诺）。 */
import { execFile } from 'node:child_process'

export const IS_WIN = process.platform === 'win32'

/** PS -EncodedCommand：base64(UTF-16LE)。Git-bash/参数直传会把中文按 GBK 损坏，必须编码。 */
export function toEncodedCommand(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64')
}

function psEscape(value: string): string {
  return "'" + value.replaceAll("'", "''") + "'"
}

/** 文件列表写入系统剪贴板（CF_HDROP）。paths=绝对路径数组（粘贴到资源管理器即得这些文件）。 */
export function fileDropScript(paths: string[]): string {
  const quoted = paths.map(psEscape).join(', ')
  return `Add-Type -AssemblyName System.Windows.Forms; $l = New-Object System.Collections.Specialized.StringCollection; @(${quoted}) | ForEach-Object { [void]$l.Add($_) }; [System.Windows.Forms.Clipboard]::SetFileDropList($l)`
}

/** 图片位图写入系统剪贴板（path=PNG 临时文件绝对路径）。
    0.0.55（反馈④）: 原实现把 base64 内嵌进脚本 → `-EncodedCommand`（UTF-16LE base64，约 2.67×）
    在 Windows 32767 字符命令行上限前炸掉（图片 >~9KB 必失败，实测 300KB → 109 万字符），
    Node 侧 `spawn ENAMETOOLONG` → "复制 PNG 失败"。改为只传路径（脚本 ~200 字符），字节由
    PowerShell 读文件。
    0.0.55（反馈④二次）: `Clipboard::SetImage` 只提供 CF_BITMAP（无 alpha）——透明区域读回变
    浅灰(211,211,211)。改为 DataObject 同时携带 **"PNG" 原始字节**（支持该格式的接收方保留透明）
    + 位图（兼容只认 CF_BITMAP 的应用）。实测：格式表含 PNG，读回角落 alpha=0（透明保持）。 */
export function imageClipScript(path: string): string {
  const p = psEscape(path)
  /* 不盲标 PNG：仅当字节确为 PNG 签名(89 50 4E 47) 才附 'PNG' 格式（jpeg/webp/gif 载荷误标会让
     接收方按 PNG 解析失败）；其余情况仅走位图格式。 */
  return `Add-Type -AssemblyName System.Windows.Forms, System.Drawing; $bytes = [IO.File]::ReadAllBytes(${p}); $isPng = $bytes.Length -gt 8 -and $bytes[0] -eq 137 -and $bytes[1] -eq 80 -and $bytes[2] -eq 78 -and $bytes[3] -eq 71; $img = [System.Drawing.Image]::FromStream((New-Object IO.MemoryStream(,$bytes))); $obj = New-Object System.Windows.Forms.DataObject; if ($isPng) { $obj.SetData('PNG', (New-Object IO.MemoryStream(,$bytes))) }; $obj.SetImage($img); [System.Windows.Forms.Clipboard]::SetDataObject($obj, $true); $img.Dispose()`
}

/** 0.0.55（反馈②）: 任意可解码图片文件 → 先转 PNG 再入剪贴板（位图 + PNG 原始字节，透明保持）。
    供"文件卡上的图片文件"复制为图片（webp/avif/svg 等 System.Drawing 不支持的格式会解码失败）。 */
export function imageFileClipScript(path: string): string {
  const p = psEscape(path)
  return `Add-Type -AssemblyName System.Windows.Forms, System.Drawing; $img = [System.Drawing.Image]::FromFile(${p}); $ms = New-Object IO.MemoryStream; $img.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png); $img.Dispose(); $bytes = $ms.ToArray(); $img2 = [System.Drawing.Image]::FromStream((New-Object IO.MemoryStream(,$bytes))); $obj = New-Object System.Windows.Forms.DataObject; $obj.SetData('PNG', (New-Object IO.MemoryStream(,$bytes))); $obj.SetImage($img2); [System.Windows.Forms.Clipboard]::SetDataObject($obj, $true); $img2.Dispose()`
}

/** G45（0.0.103）：公式「复制为 SVG」——DataObject 同时携带 SVG 原始字节（'image/svg+xml'）与
    PNG 兜底（'PNG' 原始字节 + 位图）——支持矢量的应用（Word/PPT/WPS/Illustrator）取 SVG，其余取 PNG。
    pngPath 传空串则仅写 SVG 格式（极端兜底路径）。 */
export function svgClipScript(svgPath: string, pngPath: string): string {
  const s = psEscape(svgPath)
  const p = psEscape(pngPath)
  return `Add-Type -AssemblyName System.Windows.Forms, System.Drawing; $svg = [IO.File]::ReadAllBytes(${s}); $obj = New-Object System.Windows.Forms.DataObject; $obj.SetData('image/svg+xml', (New-Object IO.MemoryStream(,$svg))); $img = $null; if (${p} -ne '' -and (Test-Path ${p})) { $png = [IO.File]::ReadAllBytes(${p}); $obj.SetData('PNG', (New-Object IO.MemoryStream(,$png))); $img = [System.Drawing.Image]::FromStream((New-Object IO.MemoryStream(,$png))); $obj.SetImage($img) }; [System.Windows.Forms.Clipboard]::SetDataObject($obj, $true); if ($img -ne $null) { $img.Dispose() }`
}

/** G45（0.0.103）：公式「复制为 MathML」——以 CF_HTML（'HTML Format'）写入；Word 等把 <math> 转为原生公式。
    htmlPath = cfHtmlDocument() 产物落盘的临时文件（CF_HTML 偏移按 UTF-8 字节计）。 */
export function mathmlClipScript(htmlPath: string): string {
  const p = psEscape(htmlPath)
  return `Add-Type -AssemblyName System.Windows.Forms; $bytes = [IO.File]::ReadAllBytes(${p}); $obj = New-Object System.Windows.Forms.DataObject; $obj.SetData('HTML Format', (New-Object IO.MemoryStream(,$bytes))); [System.Windows.Forms.Clipboard]::SetDataObject($obj, $true)`
}

/** G45（0.0.103）：CF_HTML（'HTML Format'）封装——固定宽度偏移占位后按 UTF-8 字节精算
    （Windows CF_HTML 规范：Version/StartHTML/EndHTML/StartFragment/EndFragment）。纯函数，可单测。 */
export function cfHtmlDocument(fragmentHtml: string): string {
  const head = '<html><body><!--StartFragment-->'
  const tail = '<!--EndFragment--></body></html>'
  const pad = (value: number) => String(value).padStart(10, '0')
  const build = (startHtml: number, endHtml: number, startFragment: number, endFragment: number) =>
    'Version:0.9\r\nStartHTML:' + pad(startHtml) + '\r\nEndHTML:' + pad(endHtml) +
    '\r\nStartFragment:' + pad(startFragment) + '\r\nEndFragment:' + pad(endFragment) + '\r\n'
  const offset = Buffer.byteLength(build(0, 0, 0, 0), 'utf8')
  const startHtml = offset
  const startFragment = startHtml + Buffer.byteLength(head, 'utf8')
  const endFragment = startFragment + Buffer.byteLength(fragmentHtml, 'utf8')
  const endHtml = endFragment + Buffer.byteLength(tail, 'utf8')
  return build(startHtml, endHtml, startFragment, endFragment) + head + fragmentHtml + tail
}

export function runPowershell(script: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!IS_WIN) { reject(new Error('not supported on this platform')); return }
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', toEncodedCommand(script)], { timeout: 15000 }, (error) => {
      if (error) reject(error)
      else resolve()
    })
  })
}

/** 系统默认应用打开（Start-Process）。vscode.env.openExternal 对 file:// 在 Windows 有 0x2 怪癖（2026-09-02 实测），统一走 PowerShell。 */
export function startProcessScript(absolutePath: string): string {
  return `Start-Process -FilePath ${psEscape(absolutePath)}`
}

export function runStartProcess(absolutePath: string): Promise<void> {
  return runPowershell(startProcessScript(absolutePath))
}

/** Windows "打开方式"对话框（rundll32 shell32.dll,OpenAs_RunDLL）。
    0.0.56（审核 P2）: 补 15s 超时——rundll32 被阻塞时 Promise 曾永挂（失败也无法提示）。 */
export function runOpenWith(absolutePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!IS_WIN) { reject(new Error('not supported on this platform')); return }
    execFile('rundll32.exe', ['shell32.dll,OpenAs_RunDLL', absolutePath], { timeout: 15000 }, (error) => {
      if (error) reject(error)
      else resolve()
    })
  })
}
