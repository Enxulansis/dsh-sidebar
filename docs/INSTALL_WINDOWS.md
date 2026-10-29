---
_file:
  created: "2026-10-29 15:08"
  updated: "2026-10-29 15:47"
  status: final
---

# Windows 安装、升级与回退

本指南面向DSH Sidebar 0.1.171及DeepSeek Harness 0.2.1-rc.4。请从 [GitHub预发布页面](https://github.com/Enxulansis/dsh-sidebar/releases/tag/v0.1.171-rc4-preview.1) 获取同一候选的安装材料。配套ZIP含VSIX、说明及取消修补脚本；完整源码在本仓库。不要将旧版Marketplace包与本候选混用。

## 安装前

准备VS Code 1.100+、Node.js `^22.19.0 || >=24.0.0`，以及PowerShell 7。模型凭据由使用者自行配置。保留原DSH设置、旧VSIX、后端及home；不要将新后端直接指向日常旧home。

下面以 `C:/DSHPreview` 为示例，可改成你有写入权限的目录。路径是示例，不会自动替你创建完整发行包。全新机器安装仍需单独验收，不能把本机已有装配的测试结果视为该步骤已经全面通过。

## 准备独立后端

在PowerShell 7中运行以下命令；使用新的目录，已有目录先检查内容，避免覆盖其他装配。

```powershell
$ErrorActionPreference = 'Stop'
$previewRoot = 'C:/DSHPreview'
New-Item -ItemType Directory -Path "$previewRoot/runtime", "$previewRoot/home" -Force | Out-Null
npm install --prefix "$previewRoot/runtime" --save-exact '@deepseek-ai/dsh@0.2.1-rc.4'
if ($LASTEXITCODE -ne 0) { throw '后端安装失败' }
& "$previewRoot/runtime/node_modules/.bin/dsh.cmd" --version
if ($LASTEXITCODE -ne 0) { throw '后端版本检查失败' }
```

确认输出为目标RC4版本。精确固定顶层包并不保证未来重新解析的所有传递依赖字节相同；保留生成的锁文件。修补工具会进一步核对实际依赖内容，不能跳过其哈希检查。

## 图片准备取消修补

图片准备阶段取消恢复依赖本项目提供的本地运行时修补，**不是官方RC4的新发行版本**，也不在VSIX内。工具对已知源码和声明文件做哈希校验，遇到未知内容应停止，不要手动绕过检查。

在候选源码根目录执行，`--runtime-root` 是包含 `node_modules` 的装配根目录，不是其中的 `@deepseek-ai/dsh` 包目录：

```powershell
$ErrorActionPreference = 'Stop'
node ./scripts/repair-runtime-admission.mjs --runtime-root 'C:/DSHPreview/runtime' --backup-dir 'C:/DSHPreview/repair-backup' --report 'C:/DSHPreview/repair-report.json'
if ($LASTEXITCODE -ne 0) { throw '修补前校验失败，停止安装' }
node ./scripts/repair-runtime-admission.mjs --runtime-root 'C:/DSHPreview/runtime' --backup-dir 'C:/DSHPreview/repair-backup' --report 'C:/DSHPreview/repair-report.json' --apply
if ($LASTEXITCODE -ne 0) { throw '修补未成功，请检查报告' }
```

第一次不带 `--apply` 只校验并写报告；第二次才修改目标文件，备份目录必须尚未存在。保留备份及报告。用相同参数重跑时，已安装状态会核对修补后的哈希；启动中的后端需正常重启才能读取修补文件。

未应用修补时，不应期待获得本文描述的完整图片准备取消行为。安装步骤不需要复制旧第三方插件，也不要求导入Router预设。

## 安装VSIX并配置

在目标VS Code窗口运行 **Extensions: Install from VSIX...**，选择对应候选文件。要隔离试用，可先用独立用户数据和扩展目录启动VS Code，再在该窗口安装：

```powershell
$ErrorActionPreference = 'Stop'
code --user-data-dir 'C:/DSHPreview/vscode-data' --extensions-dir 'C:/DSHPreview/vscode-extensions' --new-window
if ($LASTEXITCODE -ne 0) { throw '隔离窗口启动失败' }
```

若 `code` 不在PATH，使用实际VS Code CLI路径。请在这个目标窗口的**用户设置JSON**中合并以下设置，不要覆盖其他设置；`home` 是machine级设置，不建议放进项目共享文件：

```json
{
  "deepseekHarness.home": "C:/DSHPreview/home",
  "deepseekHarness.executable": "C:/DSHPreview/runtime/node_modules/.bin/dsh.cmd",
  "deepseekHarness.arguments": ["web", "--host", "127.0.0.1", "--port", "0", "--no-open"],
  "deepseekHarness.reuseExistingRuntime": false
}
```

运行 **Developer: Reload Window**，打开受信任的测试项目，再打开DSH侧栏。通过“模型与连接”配置凭据。凭据不要写进上述共享示例或提交到GitHub。

## 首次核验

- 确认扩展版本为171，后端为RC4，运行目录指向刚配置的独立位置。
- 新建会话，检查普通／计划及权限菜单；默认base profile应显示三档权限。
- 用只读任务确认真实回复；再在专用测试目录检查审批拒绝、停止和草稿恢复。
- 检查输入、会话和后台任务状态，确认没有把日常旧会话误当成丢失数据。

安装成功不等于当前窗口已经加载新版；应在重载后核对。上述步骤是使用者检查清单，不是对所有新机器已测试通过的声明。

## 更新现有RC4环境

保留当前VSIX、设置及home备份；安装新版侧栏后重载。若后端或修补版本变化，应按相应发行说明重新准备并验证，不能对未知依赖强行重复写补丁。本候选只更新侧栏时，不要求覆盖模型凭据或删除会话。

第三方插件、旧profile整包及旧会话数据库不属于本项目的迁移服务。自定义预设也不是基础安装的前置条件。

## 回退

1. 停止候选任务，记录候选的运行目录与DSH设置，关闭对应窗口。
2. 重装保留的旧VSIX，恢复原后端路径、启动参数、home及复用设置；旧版没有的设置按原备份恢复。
3. 重载窗口，核对后端版本与旧会话。候选home另行保留，不反向覆盖旧数据。

此步骤恢复运行装配，不会自动撤销模型对项目或外部服务已作的修改。没有旧包和备份时，不要用删除全部数据来代替回退。

## 从源码构建

取得最终确认的源码后，在源码目录使用项目声明的pnpm版本安装依赖，再检查和打包：

```powershell
$ErrorActionPreference = 'Stop'
pnpm install --frozen-lockfile
if ($LASTEXITCODE -ne 0) { throw '依赖安装失败' }
pnpm run check
if ($LASTEXITCODE -ne 0) { throw '检查失败' }
pnpm run package
if ($LASTEXITCODE -ne 0) { throw '打包失败' }
```

当前 `packageManager` 声明为pnpm 11.7.0，输出文件为 `dsh-sidebar-0.1.171-rc4-preview.vsix`。本地构建和打包不等于上传；不要调用历史发布脚本来完成普通安装。
