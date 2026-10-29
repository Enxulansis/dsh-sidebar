import { describe, expect, it } from 'vitest'
import { fileDropScript, imageClipScript, imageFileClipScript, startProcessScript, toEncodedCommand } from '../src/system-clipboard.js'

describe('system-clipboard PowerShell bridges (G10 右键菜单)', () => {
  it('encodes scripts as base64 UTF-16LE (中文路径安全, -EncodedCommand)', () => {
    const b64 = toEncodedCommand("Write-Output '你好'")
    const decoded = Buffer.from(b64, 'base64').toString('utf16le')
    expect(decoded).toBe("Write-Output '你好'")
    expect(b64).not.toContain('Write-Output') // 明文不出现在编码里
  })

  it('builds a CF_HDROP file-drop script with quote escaping', () => {
    const script = fileDropScript(['D:\\proj\\_temp\\demo.docx', "D:\\a'b\\x.pdf"])
    expect(script).toContain('System.Collections.Specialized.StringCollection')
    expect(script).toContain('[System.Windows.Forms.Clipboard]::SetFileDropList($l)')
    expect(script).toContain("'D:\\proj\\_temp\\demo.docx'")
    expect(script).toContain("'D:\\a''b\\x.pdf'") // 单引号翻倍转义
  })

  it('builds an image-clipboard script that reads a temp file and keeps PNG transparency (0.0.55)', () => {
    /* 反馈④：base64 内嵌会让 -EncodedCommand 超出 Windows 命令行上限（>~9KB 图必失败——
       实测 300KB 图编码后 109 万字符、Node spawn ENAMETOOLONG），改为传文件路径、脚本长度恒定。
       二次修复：SetImage 只给 CF_BITMAP（无 alpha，透明读回变浅灰 211,211,211）→ DataObject
       同时携带 'PNG' 原始字节（仅 PNG 签名时）+ 位图；实测格式表含 PNG 且读回 alpha=0。 */
    const script = imageClipScript('C:\\tmp\\dsh-image-clip-x.png')
    expect(script).toContain("[IO.File]::ReadAllBytes('C:\\tmp\\dsh-image-clip-x.png')")
    expect(script).toContain("$obj.SetData('PNG'")
    expect(script).toContain('$isPng')
    expect(script).toContain('[System.Windows.Forms.Clipboard]::SetDataObject($obj, $true)')
    expect(script).not.toContain('FromBase64String')
    expect(script.length).toBeLessThan(900) // 长度恒定（此前随图片线性增长）
  })

  it('builds an image-file clipboard script that converts to PNG first (0.0.55 反馈②)', () => {
    const script = imageFileClipScript('C:\\tmp\\photo.jpg')
    expect(script).toContain("FromFile('C:\\tmp\\photo.jpg')")
    expect(script).toContain('[System.Drawing.Imaging.ImageFormat]::Png')
    expect(script).toContain("$obj.SetData('PNG'")
    expect(script).toContain('[System.Windows.Forms.Clipboard]::SetDataObject($obj, $true)')
  })

  it('builds a Start-Process script (openExternal 0x2 workaround)', () => {
    const script = startProcessScript('D:\\a b\\doc.docx')
    expect(script).toContain("Start-Process -FilePath 'D:\\a b\\doc.docx'")
  })

  it('startProcessScript escapes single quotes', () => {
    expect(startProcessScript("D:\\x'y.docx")).toContain("'D:\\x''y.docx'")
  })
})
