import * as fs from 'node:fs'
import * as path from 'node:path'
import { randomUUID } from 'node:crypto'
import * as vscode from 'vscode'
import type { DshEvent } from './conversation.js'
import type { HistoryEntry } from './dsh-client.js'
import { comparableFilePath, linkSearchPattern, rankLinkCandidate } from './file-path.js'

export interface ChangedFileItem {
  path: string
  additions: number
  deletions: number
  canRevert: boolean
}

export interface ChangedFileGroup {
  turn: number
  files: ChangedFileItem[]
}

interface FileDiff {
  path: string
  oldText: string | null
  newText: string
}

interface PendingFile {
  absolutePath: string
  displayPath: string
  before?: FileImage
  diffs: FileDiff[]
  turn: number
}

interface ReviewSnapshot {
  before: string | null
  after: string | null
  fullFile: boolean
  additions: number
  deletions: number
}

interface ReviewFile {
  absolutePath: string
  displayPath: string
  turn: number
  snapshots: ReviewSnapshot[]
}

interface FileImage {
  text: string | null
}

interface UnknownRecord {
  [key: string]: unknown
}

const MAX_SNAPSHOT_BYTES = 5 * 1024 * 1024

const DISMISSED_STORAGE_KEY = 'dsh.diffDismissed'

function record(value: unknown): UnknownRecord | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as UnknownRecord : undefined
}

function callIdOf(event: DshEvent): string | undefined {
  const data = record(event.data)
  if (event.type === 'tool/call') return typeof data?.callId === 'string' ? data.callId : undefined
  if (event.type !== 'tool/result') return undefined
  const message = record(data?.message)
  const source = record(message?.source)
  if (typeof source?.callId === 'string') return source.callId
  const first = Array.isArray(message?.content) ? record(message.content[0]) : undefined
  return typeof first?.toolCallId === 'string' ? first.toolCallId : undefined
}

function failedResult(event: DshEvent): boolean {
  const data = record(event.data)
  if (data?.error !== undefined) return true
  const message = record(data?.message)
  return Array.isArray(message?.content) && message.content.some(value => record(value)?.isError === true)
}

function turnOf(event: DshEvent): number {
  const turn = record(event.data)?.turn
  return typeof turn === 'number' && Number.isSafeInteger(turn) && turn > 0 ? turn : 0
}

function diffsOf(value: unknown, expected: 'call' | 'result'): FileDiff[] {
  const wrapper = record(value)
  const view = wrapper?.for === expected ? record(wrapper.view) : undefined
  if (view?.card !== 'diff' || !Array.isArray(view.diffs)) return []
  return view.diffs.flatMap((value): FileDiff[] => {
    const diff = record(value)
    if (
      typeof diff?.path !== 'string'
      || (diff.oldText !== null && typeof diff.oldText !== 'string')
      || typeof diff.newText !== 'string'
    ) return []
    return [{ path: diff.path, oldText: diff.oldText, newText: diff.newText }]
  })
}

function inside(basePath: string, filePath: string): boolean {
  const relative = path.relative(path.resolve(basePath), path.resolve(filePath))
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`))
}

/* stat 的"缺失/不可达"统一折叠成 undefined——调用方据此决定是否走回退搜索；目录/文件判定留给调用方。 */
async function statOrUndefined(uri: vscode.Uri): Promise<vscode.FileStat | undefined> {
  try {
    return await vscode.workspace.fs.stat(uri)
  } catch {
    return undefined
  }
}

function projectPath(cwd: string, value: string): string | undefined {
  const resolved = path.normalize(path.isAbsolute(value) ? value : path.resolve(cwd, value))
  return inside(cwd, resolved) ? resolved : undefined
}

function readImage(filePath: string): FileImage | undefined {
  try {
    const stat = fs.statSync(filePath)
    if (!stat.isFile() || stat.size > MAX_SNAPSHOT_BYTES) return undefined
    return { text: fs.readFileSync(filePath, 'utf8') }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { text: null }
    return undefined
  }
}

function groupedDiffs(cwd: string, diffs: readonly FileDiff[], turn: number): Map<string, PendingFile> {
  const grouped = new Map<string, PendingFile>()
  for (const diff of diffs) {
    const absolutePath = projectPath(cwd, diff.path)
    if (absolutePath === undefined) continue
    const key = comparableFilePath(absolutePath)
    const existing = grouped.get(key)
    if (existing === undefined) {
      grouped.set(key, {
        absolutePath,
        displayPath: path.relative(cwd, absolutePath) || path.basename(absolutePath),
        diffs: [diff],
        turn,
      })
    } else {
      existing.diffs.push(diff)
    }
  }
  return grouped
}

function changedLineCount(value: string | null): number {
  if (value === null || value === '') return 0
  const lines = value.split(/\r?\n/)
  return lines.length - (lines.at(-1) === '' ? 1 : 0)
}

function lineStats(diffs: readonly FileDiff[]): { additions: number; deletions: number } {
  return diffs.reduce((total, diff) => ({
    additions: total.additions + changedLineCount(diff.newText),
    deletions: total.deletions + changedLineCount(diff.oldText),
  }), { additions: 0, deletions: 0 })
}

function fragmentSnapshot(diffs: readonly FileDiff[]): ReviewSnapshot | undefined {
  const changed = diffs.filter(diff => (diff.oldText ?? '') !== diff.newText)
  if (changed.length === 0) return undefined
  const separator = '\n\n⋯ unchanged lines ⋯\n\n'
  return {
    before: changed.map(diff => diff.oldText ?? '').join(separator),
    after: changed.map(diff => diff.newText).join(separator),
    fullFile: false,
    ...lineStats(changed),
  }
}

/** Tracks official DSH diff events and opens their changes in VS Code's native editors. */
export class DiffReviewManager implements vscode.TextDocumentContentProvider, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<vscode.Uri>()
  private readonly content = new Map<string, { sessionId: string; text: string }>()
  private readonly pending = new Map<string, Map<string, PendingFile>>()
  private readonly reviews = new Map<string, Map<number, Map<string, ReviewFile>>>()
  private readonly dismissed = new Map<string, Set<string>>()
  private readonly closedDocument: vscode.Disposable

  /* 0.0.141（用户反馈①：reload 后已"全部保留"的变更块又弹出）：保留标记持久化到
     workspaceState——此前只存内存，窗口 Reload = 扩展宿主重启 = 记忆清空，会话历史
     重放（rebuild/prependHistory）会把已保留的条目重新收录回变更块。 */
  constructor(private readonly memento?: vscode.Memento) {
    this.closedDocument = vscode.workspace.onDidCloseTextDocument(document => {
      this.content.delete(document.uri.toString())
    })
    const stored = memento?.get<Record<string, unknown>>(DISMISSED_STORAGE_KEY)
    if (stored === undefined || stored === null || typeof stored !== 'object') return
    for (const [sessionId, keys] of Object.entries(stored)) {
      if (!Array.isArray(keys)) continue
      this.dismissed.set(sessionId, new Set(keys.filter((key): key is string => typeof key === 'string')))
    }
  }

  readonly onDidChange = this.changed.event

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.content.get(uri.toString())?.text ?? ''
  }

  dispose(): void {
    this.closedDocument.dispose()
    this.changed.dispose()
    this.content.clear()
    this.pending.clear()
    this.reviews.clear()
    this.dismissed.clear()
  }

  clear(): void {
    this.content.clear()
    this.pending.clear()
    this.reviews.clear()
  }

  /** Trash drops large transient snapshots; keep decisions survive restoration. */
  releaseSession(sessionId: string): void {
    this.clearSession(sessionId)
    for (const [uri, value] of this.content) if (value.sessionId === sessionId) this.content.delete(uri)
  }

  purgeSession(sessionId: string): void {
    this.releaseSession(sessionId)
    if (this.dismissed.delete(sessionId)) this.persistDismissed()
  }

  rebuild(sessionId: string, cwd: string, entries: readonly HistoryEntry[]): ChangedFileGroup[] {
    this.clearSession(sessionId)
    for (const entry of entries) this.accept(sessionId, cwd, entry.event, entry.view, true)
    return this.changedFiles(sessionId)
  }

  /** Replay an older, complete history page without discarding reversible live snapshots. */
  prependHistory(sessionId: string, cwd: string, entries: readonly HistoryEntry[]): ChangedFileGroup[] {
    for (const entry of entries) this.accept(sessionId, cwd, entry.event, entry.view, true)
    return this.changedFiles(sessionId)
  }

  accept(sessionId: string, cwd: string, event: DshEvent, view?: unknown, replay = false): boolean {
    if (event.type === 'turn/end') {
      const turn = turnOf(event)
      for (const [key, files] of this.pending) {
        if (key.startsWith(`${sessionId}:`) && [...files.values()].some(file => file.turn === turn)) this.pending.delete(key)
      }
      return false
    }
    const callId = callIdOf(event)
    if (callId === undefined) return false
    const key = `${sessionId}:${callId}`
    const turn = turnOf(event)

    if (event.type === 'tool/call') {
      const files = groupedDiffs(cwd, diffsOf(view, 'call'), turn)
      if (!replay) {
        for (const file of files.values()) {
          const before = readImage(file.absolutePath)
          if (before !== undefined) file.before = before
        }
      }
      if (files.size > 0) this.pending.set(key, files)
      return false
    }

    if (event.type !== 'tool/result') return false
    const pending = this.pending.get(key)
    this.pending.delete(key)
    if (failedResult(event)) return false

    // A newly created file may not have had a realpath during tool/call. Resolve
    // pending entries again now that tool/result has made the path observable.
    const currentPending = pending === undefined
      ? undefined
      : new Map([...pending.values()].map(file => [comparableFilePath(file.absolutePath), file]))
    const results = groupedDiffs(cwd, diffsOf(view, 'result'), turn)
    const fileKeys = new Set([...(currentPending?.keys() ?? []), ...results.keys()])
    let updated = false
    for (const fileKey of fileKeys) {
      const callFile = currentPending?.get(fileKey)
      const resultFile = results.get(fileKey)
      const absolutePath = callFile?.absolutePath ?? resultFile?.absolutePath
      if (absolutePath === undefined) continue
      const displayPath = callFile?.displayPath ?? resultFile?.displayPath ?? path.relative(cwd, absolutePath)
      const fileTurn = resultFile?.turn ?? callFile?.turn ?? turn
      const diffs = resultFile?.diffs ?? callFile?.diffs ?? []
      const after = replay ? undefined : readImage(absolutePath)
      const stats = lineStats(diffs)
      const snapshot = callFile?.before !== undefined && after !== undefined && callFile.before.text !== after.text
        ? { before: callFile.before.text, after: after.text, fullFile: true, ...stats }
        : fragmentSnapshot(diffs)
      if (snapshot === undefined) continue
      this.record(sessionId, { absolutePath, displayPath, turn: fileTurn, snapshots: [snapshot] })
      updated = true
    }
    return updated
  }

  changedFiles(sessionId: string): ChangedFileGroup[] {
    const turns = this.reviews.get(sessionId)
    if (turns === undefined) return []
    return [...turns.entries()]
      .sort(([left], [right]) => right - left)
      .map(([turn, files]) => ({
        turn,
        files: [...files.values()].map(file => {
          const stats = file.snapshots.reduce((total, snapshot) => ({
            additions: total.additions + snapshot.additions,
            deletions: total.deletions + snapshot.deletions,
          }), { additions: 0, deletions: 0 })
          return {
            path: file.displayPath,
            ...stats,
            canRevert: this.reviewContent(file).fullFile,
          }
        }),
      }))
      .filter(group => group.files.length > 0)
  }

  /* 0.1.22（用户实测）：agent 正文里的链接常是**相对它自己的工作目录**写的（例：figures/own/x.png，
     文件实际在 _temp/drafts/.../figures/own/ 下）——按项目根解析落空时按"路径后缀"回退搜索，
     命中即打开（多命中取 _temp 优先 / 路径最浅者）；找不到才报错，错误文案不外泄原始 ENOENT。 */
  private async searchBySuffix(cwd: string, value: string): Promise<vscode.Uri | undefined> {
    const pattern = linkSearchPattern(value)
    if (pattern === undefined) return undefined
    let matches: vscode.Uri[] = []
    try {
      matches = await vscode.workspace.findFiles(new vscode.RelativePattern(vscode.Uri.file(cwd), pattern), undefined, 30)
    } catch {
      return undefined
    }
    if (matches.length === 0) return undefined
    const sorted = [...matches].sort((left, right) => rankLinkCandidate(cwd, left.fsPath) - rankLinkCandidate(cwd, right.fsPath))
    const best = sorted[0]
    if (best === undefined) return undefined
    if (matches.length > 1) {
      void vscode.window.showInformationMessage(`同名文件有 ${String(matches.length)} 个，已打开最匹配的：${path.relative(cwd, best.fsPath)}`)
    }
    return best
  }

  /* 0.1.23：解析与"用哪种方式打开"拆开——控制层先按类型分流（图片走侧栏预览、二进制交 VS Code），
     这里只负责把 value 解析成真实存在的绝对路径（含后缀回退搜索）。 */
  async resolveOpenPath(cwd: string, value: string): Promise<string | undefined> {
    const filePath = projectPath(cwd, value)
    if (filePath === undefined) throw new Error('该文件在当前 DeepSeek 项目之外。')
    const direct = await statOrUndefined(vscode.Uri.file(filePath))
    if (direct !== undefined) return filePath
    const found = await this.searchBySuffix(cwd, value)
    if (found === undefined) {
      throw new Error(`找不到「${value}」：按项目根解析不存在，按路径后缀回退搜索也没有匹配。`)
    }
    return found.fsPath
  }

  /** 目录 → 资源管理器定位；其余 → 文本编辑器打开（调用方已判定它按文本打开是合适的）。 */
  async openResolved(filePath: string, line?: number): Promise<void> {
    const uri = vscode.Uri.file(filePath)
    const stat = await statOrUndefined(uri)
    if (stat === undefined) throw new Error(`找不到「${filePath}」。`)
    if ((stat.type & vscode.FileType.Directory) !== 0) {
      await vscode.commands.executeCommand('revealInExplorer', uri)
      return
    }
    const document = await vscode.workspace.openTextDocument(uri)
    const targetLine = line === undefined ? undefined : Math.max(0, Math.min(line - 1, document.lineCount - 1))
    const selection = targetLine === undefined ? undefined : new vscode.Range(targetLine, 0, targetLine, 0)
    await vscode.window.showTextDocument(document, {
      preview: true,
      ...(selection === undefined ? {} : { selection }),
    })
  }

  async reviewFile(sessionId: string, cwd: string, value: string, turn?: number): Promise<void> {
    const review = this.findReview(sessionId, cwd, value, turn)
    if (review === undefined) throw new Error(`No completed DeepSeek change is available for ${value}.`)
    await this.openReview(sessionId, review, true)
  }

  async reviewAll(sessionId: string): Promise<void> {
    const reviews = this.allReviews(sessionId)
    if (reviews.length === 0) throw new Error('没有可审阅的 DeepSeek 变更。')
    for (const review of reviews.slice(0, 20)) await this.openReview(sessionId, review, false)
    if (reviews.length > 20) void vscode.window.showInformationMessage('已打开前 20 个变更文件。')
  }

  keepFile(sessionId: string, cwd: string, value: string, turn: number): ChangedFileGroup[] {
    const review = this.findReview(sessionId, cwd, value, turn)
    if (review === undefined) throw new Error(`No completed DeepSeek change is available for ${value}.`)
    this.dismiss(sessionId, review)
    return this.changedFiles(sessionId)
  }

  keepAll(sessionId: string): ChangedFileGroup[] {
    for (const review of this.allReviews(sessionId)) this.markDismissed(sessionId, review)
    this.reviews.delete(sessionId)
    return []
  }

  revertFile(sessionId: string, cwd: string, value: string, turn: number): ChangedFileGroup[] {
    const review = this.findReview(sessionId, cwd, value, turn)
    if (review === undefined) throw new Error(`No completed DeepSeek change is available for ${value}.`)
    const content = this.validateRevert(review)
    this.applyRevert(review, content.before)
    this.dismiss(sessionId, review)
    return this.changedFiles(sessionId)
  }

  revertAll(sessionId: string): ChangedFileGroup[] {
    const reviews = this.allReviews(sessionId)
    if (reviews.length === 0) throw new Error('没有可回退的 DeepSeek 变更。')
    const byFile = new Map<string, ReviewFile[]>()
    for (const review of reviews) {
      const key = comparableFilePath(review.absolutePath)
      const existing = byFile.get(key)
      if (existing === undefined) byFile.set(key, [review])
      else existing.push(review)
    }
    const validated = [...byFile.values()].map(series => this.validateRevertSeries(series))
    for (const item of validated) this.applyRevert(item.review, item.before)
    for (const review of reviews) this.markDismissed(sessionId, review)
    this.reviews.delete(sessionId)
    return []
  }

  private clearSession(sessionId: string): void {
    this.reviews.delete(sessionId)
    for (const key of this.pending.keys()) if (key.startsWith(`${sessionId}:`)) this.pending.delete(key)
  }

  private record(sessionId: string, incoming: ReviewFile): void {
    if (this.dismissed.get(sessionId)?.has(this.reviewKey(incoming))) return
    let turns = this.reviews.get(sessionId)
    if (turns === undefined) this.reviews.set(sessionId, turns = new Map())
    let files = turns.get(incoming.turn)
    if (files === undefined) turns.set(incoming.turn, files = new Map())
    const key = comparableFilePath(incoming.absolutePath)
    const existing = files.get(key)
    if (existing === undefined) files.set(key, incoming)
    else for (const snapshot of incoming.snapshots) {
      const previous = existing.snapshots.at(-1)
      // Only continuous whole-file images can collapse. Fragments and intervening
      // external edits retain their boundaries for safe revert validation.
      if (previous?.fullFile && snapshot.fullFile && previous.after === snapshot.before) {
        previous.after = snapshot.after
        previous.additions += snapshot.additions
        previous.deletions += snapshot.deletions
      } else existing.snapshots.push(snapshot)
    }
  }

  private reviewContent(review: ReviewFile): { before: string | null; after: string | null; fullFile: boolean } {
    const first = review.snapshots[0]
    const continuous = review.snapshots.slice(1).every((snapshot, index) => review.snapshots[index]?.after === snapshot.before)
    if (first?.fullFile === true && review.snapshots.every(snapshot => snapshot.fullFile) && continuous) {
      const latest = review.snapshots.at(-1)?.after ?? first.after
      return { before: first.before, after: latest, fullFile: true }
    }
    const separator = '\n\n================ next DeepSeek change ================\n\n'
    return {
      before: review.snapshots.map(snapshot => snapshot.before ?? '').join(separator),
      after: review.snapshots.map(snapshot => snapshot.after ?? '').join(separator),
      fullFile: false,
    }
  }

  private findReview(sessionId: string, cwd: string, value: string, turn?: number): ReviewFile | undefined {
    const absolutePath = projectPath(cwd, value)
    if (absolutePath === undefined) return undefined
    const key = comparableFilePath(absolutePath)
    const turns = this.reviews.get(sessionId)
    if (turn !== undefined) return turns?.get(turn)?.get(key)
    return [...(turns?.entries() ?? [])]
      .sort(([left], [right]) => right - left)
      .map(([, files]) => files.get(key))
      .find((review): review is ReviewFile => review !== undefined)
  }

  private allReviews(sessionId: string): ReviewFile[] {
    return [...(this.reviews.get(sessionId)?.values() ?? [])].flatMap(files => [...files.values()])
  }

  private reviewKey(review: ReviewFile): string {
    return `${String(review.turn)}:${comparableFilePath(review.absolutePath)}`
  }

  private markDismissed(sessionId: string, review: ReviewFile): void {
    let dismissed = this.dismissed.get(sessionId)
    if (dismissed === undefined) this.dismissed.set(sessionId, dismissed = new Set())
    dismissed.add(this.reviewKey(review))
    this.persistDismissed()
  }

  private persistDismissed(): void {
    if (this.memento === undefined) return
    const stored: Record<string, string[]> = {}
    for (const [sessionId, keys] of this.dismissed) stored[sessionId] = [...keys]
    void this.memento.update(DISMISSED_STORAGE_KEY, stored)
  }

  private dismiss(sessionId: string, review: ReviewFile): void {
    this.markDismissed(sessionId, review)
    const turns = this.reviews.get(sessionId)
    const files = turns?.get(review.turn)
    files?.delete(comparableFilePath(review.absolutePath))
    if (files?.size === 0) turns?.delete(review.turn)
    if (turns?.size === 0) this.reviews.delete(sessionId)
  }

  private validateRevert(review: ReviewFile): { before: string | null; after: string | null } {
    const content = this.reviewContent(review)
    if (!content.fullFile) {
      throw new Error(`Cannot safely revert ${review.displayPath}: its full snapshot is no longer available.`)
    }
    this.validateCurrentFile(review, content.after)
    return content
  }

  private validateRevertSeries(series: ReviewFile[]): { review: ReviewFile; before: string | null } {
    const ordered = [...series].sort((left, right) => left.turn - right.turn)
    const contents = ordered.map(review => ({ review, content: this.reviewContent(review) }))
    const unavailable = contents.find(item => !item.content.fullFile)
    if (unavailable !== undefined) {
      throw new Error(`Cannot safely revert ${unavailable.review.displayPath}: its full snapshot is no longer available.`)
    }
    for (let index = 1; index < contents.length; index += 1) {
      if (contents[index - 1]?.content.after !== contents[index]?.content.before) {
        throw new Error(`Cannot safely revert ${contents[index]?.review.displayPath}: it changed between DeepSeek turns.`)
      }
    }
    const latest = contents.at(-1)
    const earliest = contents[0]
    if (latest === undefined || earliest === undefined) throw new Error('没有可回退的 DeepSeek 变更。')
    this.validateCurrentFile(latest.review, latest.content.after)
    return { review: latest.review, before: earliest.content.before }
  }

  private validateCurrentFile(review: ReviewFile, expected: string | null): void {
    const reviewPath = comparableFilePath(review.absolutePath)
    const dirty = vscode.workspace.textDocuments.some(document =>
      document.isDirty
      && comparableFilePath(path.resolve(document.uri.fsPath)) === reviewPath,
    )
    if (dirty) throw new Error(`Cannot revert ${review.displayPath}: it has unsaved VS Code changes.`)
    const current = readImage(review.absolutePath)
    if (current === undefined) throw new Error(`Cannot safely read ${review.displayPath} before reverting.`)
    if (current.text !== expected) {
      throw new Error(`Cannot revert ${review.displayPath}: the file changed after DeepSeek edited it.`)
    }
  }

  private applyRevert(review: ReviewFile, before: string | null): void {
    if (before === null) {
      try {
        fs.unlinkSync(review.absolutePath)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
      return
    }
    fs.mkdirSync(path.dirname(review.absolutePath), { recursive: true })
    fs.writeFileSync(review.absolutePath, before, 'utf8')
  }

  private async openReview(sessionId: string, review: ReviewFile, preview: boolean): Promise<void> {
    const id = randomUUID()
    const name = path.basename(review.absolutePath)
    const beforeUri = vscode.Uri.from({ scheme: 'dsh-diff', authority: 'before', path: `/${id}/${name}` })
    const afterUri = vscode.Uri.from({ scheme: 'dsh-diff', authority: 'after', path: `/${id}/${name}` })
    const content = this.reviewContent(review)
    this.content.set(beforeUri.toString(), { sessionId, text: content.before ?? '' })
    this.content.set(afterUri.toString(), { sessionId, text: content.after ?? '' })
    await vscode.commands.executeCommand(
      'vscode.diff',
      beforeUri,
      afterUri,
      `${review.displayPath} — DeepSeek 变更（第 ${String(review.turn)} 轮）`,
      { preview },
    )
  }
}
