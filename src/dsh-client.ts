import { randomUUID } from 'node:crypto'
import { queueRowsFromInbox } from './queue.js'
import WebSocket from 'ws'
import type { DshEvent } from './conversation.js'
import { synthesizeDiffView } from './diff-view.js'
import type { PluginInventorySnapshot } from './plugin-profile.js'
import type { SettingsDescription, SettingsMutation, SettingsNamespace } from './runtime-settings.js'
import type { ConfigurableProvider, CredentialInfo, DiscoveredModel, ModelDiscoveryRequest } from './model-connections.js'

export interface SessionSummary {
  sessionId: string
  updatedAt: number
  running: boolean
  blank: boolean
  cwd?: string
  origin?: 'subagent'
  agentPreset?: string
  projections?: { asOfSeq?: number; values?: Record<string, unknown> }
}

export interface HistoryEntry {
  event: DshEvent
  view?: unknown
}

export interface SessionProjections {
  asOfSeq?: number
  values?: Record<string, unknown>
}

export interface ModelSelection {
  provider: string
  model: string
  reasoningEffort?: string
}

export interface CommandDescriptor {
  name: string
  description: string
  input?: { hint: string; attachments?: boolean }
}

export interface CommandExecution {
  commandId: string
  result: {
    kind: 'success' | 'error'
    text?: string
    sourceEventSeq?: number
  }
}

export interface SkillDescriptor {
  name: string
  description: string
  whenToUse?: string
  modelInvocable: boolean
}

export interface AgentPresetDescriptor {
  id: string
  isDefault: boolean
  name?: string
  description?: string
  broken?: string
}

export interface AgentPresetRoster {
  presets: AgentPresetDescriptor[]
}

export type ImageMediaType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'

export interface PromptImage {
  type: 'image'
  mediaType: ImageMediaType
  data: string
  name?: string
}

export interface ImageAttachment {
  attachmentId: string
  mediaType: ImageMediaType
  bytes: number
  width: number
  height: number
  name?: string
}

export type PromptMode = 'queue' | 'steer'

export type QueueAction =
  | { kind: 'edit'; content: Array<{ type: 'text'; text: string }> }
  | { kind: 'remove' }
  | { kind: 'steer' }

export interface RpcReceipt {
  accepted: boolean
  reason?: 'not-pending' | 'bad-response'
}

export interface ModelOption extends ModelSelection {
  label: string
}

export interface SessionModels {
  current: ModelSelection
  routable: boolean
  groups: Array<{
    id: string
    name: string
    models: Array<{
      id: string
      name: string
      reasoning?: { efforts: Array<{ id: string; name: string }>; defaultEffort?: string }
    }>
  }>
  failures: Array<{ id: string; name: string; message: string }>
}

export type DshFrame =
  | { channel: 'mux'; rpcId: string; payload: Record<string, unknown> }
  | { channel: 'host'; rpcId: string; payload: Record<string, unknown> }

/* 0.1.20：连接验活节拍。pingMs 发一次 ws ping；deadMs 内一个 pong 都没回来 → 判定僵尸连接，
   主动 terminate 触发既有 close→重连链路（僵尸连接自己不会发 close）。 */
export interface LivenessTiming {
  pingMs: number
  deadMs: number
}

export const DEFAULT_LIVENESS: LivenessTiming = { pingMs: 6_000, deadMs: 45_000 }
/* 0.1.112：pingMs 15s→6s —— 真机实证"会话等待提问（无流量）时每 ~14.4s 被服务端断开重连"
   （≈ 原 ping 周期 15s，即 ping 赶到之前空闲回收已发生；一轮等待里重放提问 11 次，用户填的答案
   被反复清空、旧 rpcId 提交被拒）。6s 一拍试让 ws 心跳先到、压住服务端空闲回收；若日志里
   `socket closed code=…` 显示仍被断，再换 mux 层心跳（该实验不改变任何语义，只是更勤的探活）。 */

/** 判死条件（纯函数便于单测）：对端必须先证明自己会回 pong，否则不支持 ws ping 的部署会被误杀。 */
export function livenessExpired(sawPong: boolean, lastPongAt: number, now: number, deadMs: number): boolean {
  return sawPong && now - lastPongAt > deadMs
}

interface RpcEnvelope<T> {
  type: 'server-response'
  rpcId: string
  result: { ok: true; value: T } | { ok: false; error: { message?: string; code?: string; details?: unknown } }
}

export class DshRpcError extends Error {
  readonly code: string | undefined
  readonly details: unknown
  constructor(error: { message?: string; code?: string; details?: unknown }, method: string) {
    super(error.message ?? error.code ?? `${method} failed`)
    this.name = 'DshRpcError'
    this.code = error.code
    this.details = error.details
  }
}

export class DshClient {
  private readonly streamAbort = new AbortController()
  private readonly frameListeners = new Set<(frame: DshFrame) => void>()
  private readonly errorListeners = new Set<(error: Error) => void>()
  /* 0.1.20：隔离后的帧处理诊断（只记日志，不置错误态——链路仍在工作）。 */
  private readonly frameErrorListeners = new Set<(message: string) => void>()
  /* 2026-10-05：连接生命周期取证（$events ready 等，见 onDiag）。 */
  private readonly diagListeners = new Set<(message: string) => void>()
  /* 0.1.5 适配（批次 1）：HTTP 与 WS 均要求 dsh-auth-* cookie（由带 token 的根 URL 换取）。 */
  private cookie: string | undefined
  private readonly ready: Promise<void>
  /* 0.1.5：session/page 需要 throughSeq（右界=会话当前游标）；首查探测后按会话缓存。 */
  private readonly cursorBySession = new Map<string, number>()
  /* 批次 2（0.1.5 事件流）：一条物理 WS（/api/remote.mux）+ 逻辑流（$events / session/follow）。
     0.1.1 的 events.mux/events.host 已移除；帧经翻译后仍以 DshFrame（mux/host 通道）分发，
     extension.ts 的 acceptFrame 消费面保持不变。 */
  private socket: WebSocket | undefined
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined
  private reconnectDelayMs = 2_000
  private socketEverOpened = false
  private disposed = false
  /* 0.1.20（2026-09-22 事故）：ws 的 'message' 处理器里抛异常会穿透 Node 流读取机构
     （栈底 Readable.push ← TCP.onStreamRead）——同一次 TCP 读取里后续帧全丢、close 事件
     永不触发 → 僵尸连接（既有重连逻辑完全不会启动，界面静默冻结且无任何提示）。
     两层防御：① 处理链逐层隔离，异常不许外泄；② 看门狗主动验活。 */
  private livenessTimer: ReturnType<typeof setInterval> | undefined
  private lastPongAt = 0
  /* 只在对端证明过"会回 pong"之后才允许判死——不支持 ws ping 的部署不误杀。 */
  private sawPong = false
  private streamCounter = 0
  private readonly streamKinds = new Map<string, 'events' | 'follow' | 'control' | 'jobs' | 'snapshot'>()
  private readonly projectionSnapshots = new Map<string, (error?: Error, value?: SessionProjections) => void>()
  /* session/control 流全量推送（服务端行为）：按会话缓存最近的 queue/jobs，
     供切换会话（follow 快照）时重推，避免 subscribed 清空后等到下次变化才恢复。 */
  private readonly lastQueueBySession = new Map<string, unknown>()
  private readonly projectionSequences = new Map<string, Map<string, number>>()
  private readonly lastJobsBySession = new Map<string, unknown>()
  private readonly forgottenSessions = new Set<string>()
  private followStreamId: string | undefined
  private jobsStreamId: string | undefined
  private readonly jobsSessionByStream = new Map<string, string>()
  private followSessionId: string | undefined
  /* 切换会话时旧流的在途帧可能滞后到达：帧的会话身份必须取自"该流所属会话"，
     而不是当前订阅（否则旧快照会被贴上会话 B 的标签，消息串会话）。 */
  private readonly followSessionByStream = new Map<string, string>()
  /* assistant 流式帧（wire: assistant-stream）→ 合成 assistant/chunk 事件所需：
     start 帧携带 turn/step，chunk 帧只有 attemptId；合成 seq 用负值（不影响真实 seq 空间）。 */
  private readonly attemptTurnStep = new Map<string, { turn: number; step: number }>()
  /* 0.1.79（用户报②"终止状态不统一"）：**该会话当前未结束的 step**（step/start 立、step/end 撤）。
     start 帧没看到时（中途订阅/重连/窗口重载）chunk 的兜底归并目标——绝不伪造 {0,0}（见 chunk 分支）。 */
  private readonly openStepBySession = new Map<string, { turn: number; step: number }>()
  // Cached windows survive client restarts within this extension host.
  private static chunkSeq = 0
  /* 批次 3（waterfall 应答）：$events 流代次 clientId；待应答请求按合成 rpcId 索引
     （respond(rpcId, value) 经此找到 clientId+eventId 发 `$events/result`）。 */
  private eventClientId: string | undefined
  private readonly pendingEventResults = new Map<string, { sessionId: string; clientId: string; eventId: string; kind: 'approval' | 'question'; approvalId?: string; toolName?: string; reason?: string }>()
  /* 审批帧的 approvalId 取自同会话最近的未决 approval/asked 事件（与 decided 事件同源一致）。 */
  private readonly pendingAskedBySession = new Map<string, string[]>()

  constructor(
    private readonly baseUrl: URL,
    private readonly liveness: LivenessTiming = DEFAULT_LIVENESS,
  ) {
    this.ready = this.authenticate()
  }

  private async authenticate(): Promise<void> {
    try {
      const response = await fetch(this.baseUrl, { redirect: 'manual', signal: AbortSignal.timeout(15_000) })
      const setCookies = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : []
      const pairs = setCookies.map(value => value.split(';')[0] ?? '').filter(pair => pair !== '')
      if (pairs.length > 0) this.cookie = pairs.join('; ')
    } catch {
      /* 维持无 cookie；后续请求会以 401 显式失败。 */
    }
  }

  private authHeaders(): Record<string, string> {
    return this.cookie === undefined ? {} : { cookie: this.cookie }
  }

  onFrame(listener: (frame: DshFrame) => void): () => void {
    this.frameListeners.add(listener)
    return () => { this.frameListeners.delete(listener) }
  }

  onError(listener: (error: Error) => void): () => void {
    this.errorListeners.add(listener)
    return () => { this.errorListeners.delete(listener) }
  }

  onFrameError(listener: (message: string) => void): () => void {
    this.frameErrorListeners.add(listener)
    return () => { this.frameErrorListeners.delete(listener) }
  }

  /* 2026-10-05（B 诊断留痕）：连接生命周期事件（非错误）——$events ready 的 clientId 等。
     与 frameError 分道：那是"异常已隔离"通道，这里是取证通道，都只记日志。 */
  onDiag(listener: (message: string) => void): () => void {
    this.diagListeners.add(listener)
    return () => { this.diagListeners.delete(listener) }
  }

  private reportDiag(message: string): void {
    for (const listener of [...this.diagListeners]) {
      try { listener(message) } catch { /* 取证失败静默 */ }
    }
  }

  /** 当前 ws 是否开着。提交兜底用：socket 不在时不必打 HTTP（应答必然因死流被网关丢弃）。 */
  get socketOpen(): boolean {
    return this.socket !== undefined && this.socket.readyState === WebSocket.OPEN
  }

  startStreams(): void {
    this.connectSocket()
  }

  private connectSocket(): void {
    if (this.disposed || this.socket !== undefined) return
    void this.ready.then(() => {
      if (this.disposed || this.socket !== undefined) return
      const url = new URL('/api/remote.mux', this.baseUrl)
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
      const socket = new WebSocket(
        url,
        this.cookie === undefined ? undefined : { headers: { cookie: this.cookie } },
      )
      this.socket = socket
      socket.on('open', () => {
        this.reconnectDelayMs = 2_000
        this.lastPongAt = Date.now()
        this.sawPong = false
        this.startLiveness(socket)
        this.openStream('events', '$events', { args: {} })
        this.openStream('control', 'session/control', { args: {} })
        if (this.followSessionId !== undefined) this.openFollowStream(this.followSessionId)
        /* 0.1.3：重连通知——瞬时状态帧（api-session/status）不随事件流重放，断线期间丢失会
           让上层永久停在"运行中"；重连后由上层主动重同步（session.list 带 running 字段）。 */
        const reconnected = this.socketEverOpened
        this.socketEverOpened = true
        if (reconnected) this.dispatchFrame('host', { type: 'host/socket-open' })
      })
      socket.on('pong', () => {
        this.sawPong = true
        this.lastPongAt = Date.now()
      })
      socket.on('message', (data) => {
        /* 0.1.20（2026-09-22 事故）：此回调**必须永不抛出**。异常一旦外泄，会穿过 Node 流
           读取机构砸断读循环：同一次 TCP 读取里后续帧全丢，且 close 事件永不触发（连接僵尸化，
           既有重连路径彻底失效、界面静默冻结）。 */
        try {
          this.handleSocketText(Buffer.isBuffer(data) ? data.toString('utf8') : String(data))
        } catch (error) {
          this.reportFrameError(error)
        }
      })
      socket.on('error', () => {
        /* close 事件随后到达，由它统一处理重连。 */
      })
      socket.on('close', (code, reason) => {
        /* 0.1.112（真机事故定位）：记录关闭码/原因——"会话等待提问时每 ~14s 被断开重连"需要知道
           是谁断的（服务端空闲回收 / 网络 / 客户端主动 terminate）。 */
        this.reportFrameError(new Error(`socket closed code=${String(code)}${reason === undefined || String(reason) === '' ? '' : ' reason=' + String(reason)}`))
        this.teardownSocket(socket)
        if (!this.disposed) this.scheduleReconnect()
      })
    })
  }

  /* 0.1.20：验活环——僵尸连接不会给 close，只能靠"ping 出去、pong 回不来"发现。 */
  private startLiveness(socket: WebSocket): void {
    this.stopLiveness()
    this.livenessTimer = setInterval(() => {
      if (this.socket !== socket || socket.readyState !== WebSocket.OPEN) return
      if (livenessExpired(this.sawPong, this.lastPongAt, Date.now(), this.liveness.deadMs)) {
        this.reportFrameError(new Error(`连接静默超过 ${String(Math.round(this.liveness.deadMs / 1000))}s（pong 未回），主动断开重连`))
        /* 读循环坏掉时连 'close' 都收不到（事故当天的实测形态）——重连绝不能只依赖 close：
           先就地清理连接状态，再主动重连。 */
        this.teardownSocket(socket)
        try { socket.terminate() } catch { /* 已就地重连，忽略 */ }
        this.scheduleReconnect()
        return
      }
      try { socket.ping() } catch { /* 写失败交给 close 路径 */ }
    }, this.liveness.pingMs)
  }

  private teardownSocket(socket: WebSocket): void {
    if (this.socket !== socket) return
    this.stopLiveness()
    for (const finish of [...this.projectionSnapshots.values()]) finish(new Error('DSH projection snapshot connection closed.'))
    this.socket = undefined
    this.eventClientId = undefined
    this.streamKinds.clear()
    this.followSessionByStream.clear()
    this.followStreamId = undefined
    this.attemptTurnStep.clear()
    this.openStepBySession.clear()
  }

  private stopLiveness(): void {
    if (this.livenessTimer === undefined) return
    clearInterval(this.livenessTimer)
    this.livenessTimer = undefined
  }

  /** 帧处理链异常（含看门狗判死）的隔离上报出口——绝不回抛，见 socket.on('message') 注释。
      与 onError 分开：那条会置 phase=error（锁住发送），而这里的异常已被隔离、链路仍在工作，
      只应记日志。 */
  private reportFrameError(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error)
    for (const listener of [...this.frameErrorListeners]) {
      try { listener(message) } catch { /* 上报本身失败也静默 */ }
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== undefined || this.disposed) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined
      this.connectSocket()
    }, this.reconnectDelayMs)
    this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, 30_000)
  }

  private sendStreamFrame(frame: Record<string, unknown>): void {
    if (this.socket === undefined || this.socket.readyState !== WebSocket.OPEN) return
    this.socket.send(JSON.stringify(frame))
  }

  private openStream(kind: 'events' | 'follow' | 'control' | 'jobs', endpoint: string, payload: unknown): string {
    const streamId = `${kind}-${String(++this.streamCounter)}`
    this.streamKinds.set(streamId, kind)
    this.sendStreamFrame({ type: 'open', streamId, endpoint, payload })
    return streamId
  }

  private openFollowStream(sessionId: string): void {
    this.closeJobsStream()
    this.followSessionId = sessionId
    this.followStreamId = this.openStream('follow', 'session/follow', {
      args: {
        request: {
          address: { kind: 'session', sessionId },
          assistantStream: true,
          maxMessages: 100,
        },
      },
    })
    this.followSessionByStream.set(this.followStreamId, sessionId)
    this.jobsStreamId = this.openStream('jobs', 'job/list', { args: { request: { sessionId } } })
    this.jobsSessionByStream.set(this.jobsStreamId, sessionId)
  }

  private closeJobsStream(): void {
    if (this.jobsStreamId !== undefined) {
      this.sendStreamFrame({ type: 'cancel', streamId: this.jobsStreamId })
      this.streamKinds.delete(this.jobsStreamId)
    }
    this.jobsStreamId = undefined
    this.jobsSessionByStream.clear()
    this.lastJobsBySession.clear()
  }

  /* 0.1.5 按会话开流：任一 history() 触达即确保订阅该会话（切换会话=关旧流开新流，幂等）。 */
  private ensureFollowStream(sessionId: string): void {
    this.forgottenSessions.delete(sessionId)
    if (this.followSessionId === sessionId && this.followStreamId !== undefined && this.streamKinds.has(this.followStreamId)) return
    if (this.followStreamId !== undefined && this.streamKinds.has(this.followStreamId)) {
      this.sendStreamFrame({ type: 'cancel', streamId: this.followStreamId })
      this.streamKinds.delete(this.followStreamId)
    }
    if (this.followStreamId !== undefined) this.followSessionByStream.delete(this.followStreamId)
    this.attemptTurnStep.clear()
    this.openStepBySession.clear()
    this.openFollowStream(sessionId)
  }

  private dispatchFrame(channel: 'mux' | 'host', payload: Record<string, unknown>, rpcId?: string): void {
    /* 0.1.5 的 remote 流帧无 rpcId（0.1.1 信封字段）；合成唯一值维持上层消费契约。
       waterfall 应答场景传入登记用的 rpcId（上层 respond(rpcId) 依赖它）。 */
    const frame: DshFrame = { channel, rpcId: rpcId ?? randomUUID(), payload }
    /* 0.1.20（2026-09-22 事故）：逐监听器隔离——任何一个消费方的异常都不许外泄到 socket
       回调（否则读循环被砸断、连接僵尸化），也不许拖累后面的监听器。 */
    for (const listener of [...this.frameListeners]) {
      try { listener(frame) } catch (error) { this.reportFrameError(error) }
    }
  }

  private handleSocketText(text: string): void {
    let frame: Record<string, unknown>
    try {
      const decoded: unknown = JSON.parse(text)
      if (typeof decoded !== 'object' || decoded === null) return
      frame = decoded as Record<string, unknown>
    } catch {
      return
    }
    const streamId = typeof frame.streamId === 'string' ? frame.streamId : ''
    const kind = this.streamKinds.get(streamId)
    if (kind === 'snapshot') {
      const finish = this.projectionSnapshots.get(streamId)
      if (frame.type === 'item') {
        const value = frame.value as { type?: unknown; projections?: SessionProjections } | undefined
        if (value?.type === 'snapshot') {
          const projections = value.projections
          if (projections === undefined || projections === null || typeof projections !== 'object'
            || projections.values === undefined || projections.values === null || typeof projections.values !== 'object'
            || Array.isArray(projections.values)) finish?.(new Error('DSH projection snapshot is missing projections.'))
          else finish?.(undefined, projections)
        }
      } else if (frame.type === 'error' || frame.type === 'end') {
        const error = frame.error as { message?: unknown } | undefined
        finish?.(new Error(typeof error?.message === 'string' ? error.message : 'DSH projection snapshot ended before its baseline.'))
      }
      return
    }
    if (frame.type === 'item') {
      const value = (typeof frame.value === 'object' && frame.value !== null ? frame.value : {}) as Record<string, unknown>
      if (kind === 'events') this.handleEventStreamItem(value)
      else if (kind === 'follow') this.handleFollowStreamItem(value, streamId)
      else if (kind === 'control') this.handleControlStreamItem(value)
      else if (kind === 'jobs') this.handleJobsStreamItem(value, streamId)
      return
    }
    if (frame.type === 'error' && kind !== undefined) {
      const error = typeof frame.error === 'object' && frame.error !== null ? frame.error as Record<string, unknown> : {}
      const message = typeof error.message === 'string' ? error.message : 'DSH stream error.'
      for (const listener of this.errorListeners) listener(new Error(`DSH ${kind} stream: ${message}`))
    }
  }

  /* $events 全局流 → host 帧 + waterfall 应答注册（批次 3）。 */
  private handleEventStreamItem(value: Record<string, unknown>): void {
    const type = value.type
    if (type === 'ready') {
      this.eventClientId = typeof value.clientId === 'string' ? value.clientId : undefined
      /* 2026-10-05（B 诊断留痕）：每次重连该值都会换代——风暴取证的关键锚点。 */
      this.reportDiag(`$events ready clientId=${(this.eventClientId ?? '').slice(0, 8)}`)
      return
    }
    if (type === 'cancel') {
      /* Host 侧撤回了等待应答的事件（如会话被取消）：以 resolved 帧收敛对应 UI。 */
      const eventId = typeof value.eventId === 'string' ? value.eventId : ''
      for (const [rpcId, pending] of this.pendingEventResults) {
        if (pending.eventId !== eventId) continue
        this.pendingEventResults.delete(rpcId)
        if (pending.kind === 'question') this.dispatchFrame('mux', { type: 'question/resolved', sessionId: pending.sessionId, questionRpcId: rpcId })
        else this.dispatchFrame('mux', { type: 'approval/resolved', sessionId: pending.sessionId, approvalId: pending.approvalId ?? eventId })
      }
      return
    }
    if (type === 'waterfall') {
      this.registerWaterfall(value)
      return
    }
    if (type !== 'emit') return
    const event = typeof value.event === 'string' ? value.event : ''
    const args = Array.isArray(value.args) ? value.args : []
    const sessionId = typeof args[0] === 'string' ? args[0] : ''
    switch (event) {
      case 'permission-presets/catalog-changed':
        this.dispatchFrame('host', { type: 'host/permission-catalog-changed' })
        return
      case 'api-session/status':
        this.dispatchFrame('host', { type: 'host/session-status', sessionId, running: args[1] === true })
        return
      case 'api-session/error':
        this.dispatchFrame('host', {
          type: 'host/agent-error',
          sessionId,
          message: typeof args[1] === 'string' ? args[1] : 'DeepSeek Harness reported an agent error.',
        })
        return
      case 'api-session/added': {
        const summary = typeof args[0] === 'object' && args[0] !== null ? args[0] as Record<string, unknown> : {}
        this.dispatchFrame('host', {
          type: 'host/session-added',
          sessionId: typeof summary.sessionId === 'string' ? summary.sessionId : '',
          cwd: typeof summary.cwd === 'string' ? summary.cwd : undefined,
        })
        return
      }
      default:
        /* approval/request、user-questions/request（waterfall 应答）批次 3；其余事件无消费方。 */
        return
    }
  }

  /** RC4 control contains projections only. A reconnect baseline replaces the inbox roster. */
  private handleControlStreamItem(value: Record<string, unknown>): void {
    const type = value.type
    if (type === 'baseline') {
      const payload = (typeof value.value === 'object' && value.value !== null ? value.value : {}) as Record<string, unknown>
      const projections = (typeof payload.projections === 'object' && payload.projections !== null ? payload.projections : {}) as Record<string, { asOfSeq?: number; values?: Record<string, unknown> }>
      for (const sid of this.lastQueueBySession.keys()) if (!Object.hasOwn(projections[sid]?.values ?? {}, 'inbox')) {
        this.lastQueueBySession.delete(sid)
        this.dispatchFrame('mux', { type: 'session/queue', sessionId: sid, items: [] })
      }
      for (const [sid, block] of Object.entries(projections)) {
        if (this.forgottenSessions.has(sid)) continue
        for (const [key, entry] of Object.entries(block.values ?? {})) {
          this.acceptProjection(sid, key, entry, block.asOfSeq)
        }
      }
      return
    }
    const sessionId = typeof value.sessionId === 'string' ? value.sessionId : ''
    if (this.forgottenSessions.has(sessionId)) return
    if (type === 'projection') {
      this.acceptProjection(sessionId, typeof value.key === 'string' ? value.key : '', value.value, value.seq)
    }
  }

  private acceptProjection(sessionId: string, key: string, value: unknown, sequence?: unknown): void {
    const sequences = this.projectionSequences.get(sessionId) ?? new Map<string, number>()
    const previous = sequences.get(key)
    const seq = typeof sequence === 'number' && Number.isSafeInteger(sequence) ? sequence : undefined
    // Control and follow are independent streams; a late snapshot must not roll
    // back a newer permission, inbox or other projection from the other stream.
    if (previous !== undefined && (seq === undefined || seq < previous)) return
    if (seq !== undefined) {
      sequences.set(key, seq)
      this.projectionSequences.set(sessionId, sequences)
    }
    if (key === 'inbox') {
      const items = queueRowsFromInbox(value)
      this.rememberControlSnapshot(this.lastQueueBySession, sessionId, items)
      this.dispatchFrame('mux', { type: 'session/queue', sessionId, items })
    }
    this.dispatchFrame('mux', { type: 'session/projection', sessionId, key, value, ...(seq === undefined ? {} : { seq }) })
  }

  private handleJobsStreamItem(value: Record<string, unknown>, streamId: string): void {
    const sessionId = this.jobsSessionByStream.get(streamId)
    if (sessionId === undefined || this.forgottenSessions.has(sessionId) || value.type !== 'rows') return
    const jobs = Array.isArray(value.jobs) ? value.jobs : []
    this.rememberControlSnapshot(this.lastJobsBySession, sessionId, jobs)
    this.dispatchFrame('mux', { type: 'session/jobs', sessionId, jobs })
  }

  private rememberControlSnapshot(cache: Map<string, unknown>, sessionId: string, value: unknown): void {
    if (sessionId !== '' && Array.isArray(value) && value.length > 0) cache.set(sessionId, value)
    else cache.delete(sessionId)
  }

  /* waterfall 请求（审批/提问）→ 合成 0.1.1 消费面帧；应答坐标按 rpcId 登记。 */
  private registerWaterfall(value: Record<string, unknown>): void {
    const clientId = this.eventClientId
    if (clientId === undefined) return
    const event = typeof value.event === 'string' ? value.event : ''
    const eventId = typeof value.eventId === 'string' ? value.eventId : ''
    const sessionId = typeof value.agentId === 'string' ? value.agentId : ''
    if (this.forgottenSessions.has(sessionId)) return
    const request = (typeof value.request === 'object' && value.request !== null ? value.request : {}) as Record<string, unknown>
    if (eventId === '') return
    const rpcId = randomUUID()
    const previousApprovalId = [...this.pendingEventResults.values()].find(pending => pending.eventId === eventId && pending.sessionId === sessionId && pending.kind === 'approval')?.approvalId
    /* 2026-10-05（A 同族修复）：同一 eventId 的重放（换代）会注册新 rpcId——顺手清掉旧登记，
       防长风暴雨下 pendingEventResults 泄漏（旧条目只被无 rpcId 的路径引用）。 */
    for (const [key, pending] of this.pendingEventResults) {
      if (pending.eventId === eventId && key !== rpcId) this.pendingEventResults.delete(key)
    }
    if (event === 'approval/request') {
      const asked = this.pendingAskedBySession.get(sessionId)
      const approvalId = previousApprovalId ?? asked?.[0] ?? eventId
      if (asked !== undefined) {
        const remaining = asked.filter(id => id !== approvalId)
        if (remaining.length) this.pendingAskedBySession.set(sessionId, remaining)
        else this.pendingAskedBySession.delete(sessionId)
      }
      const toolName = typeof request.toolName === 'string' ? request.toolName : 'tool'
      const reason = typeof request.reason === 'string' ? { reason: request.reason } : {}
      this.pendingEventResults.set(rpcId, { sessionId, clientId, eventId, kind: 'approval', approvalId, toolName, ...reason })
      this.dispatchFrame('mux', {
        type: 'approval/requested',
        sessionId,
        approvalId,
        toolName,
        ...reason,
      }, rpcId)
      return
    }
    if (event === 'user-questions/request') {
      this.pendingEventResults.set(rpcId, { sessionId, clientId, eventId, kind: 'question' })
      this.dispatchFrame('mux', {
        type: 'question/requested',
        sessionId,
        questions: Array.isArray(request.questions) ? request.questions : [],
      }, rpcId)
      return
    }
    /* 其余 waterfall 事件当前无消费方：立即以 next 放行（fail-open 语义与服务端默认一致）。 */
    void this.call('$events/result', {
      args: { clientId, eventId, outcome: { kind: 'next' } },
    }, 15_000).catch(() => undefined)
  }

  /* session/follow 流 → mux 帧（事件流主体）。快照 records 也推给上层——按 event.seq 去重，
     同时承担"断线重连补差"（快照含断线期间事件）。 */
  private handleFollowStreamItem(value: Record<string, unknown>, streamId: string): void {
    /* 帧的会话身份 = 该流所属会话（滞后到达的旧流帧不得被贴上当前订阅的标签）。 */
    const sessionId = this.followSessionByStream.get(streamId) ?? this.followSessionId
    if (sessionId === undefined) return
    const type = value.type
    if (type === 'snapshot') {
      /* 快照的 cursor 最新——刷新游标缓存，避免 history 用过期右界取到旧页。 */
      if (typeof value.cursor === 'number') this.cursorBySession.set(sessionId, value.cursor)
      /* 0.1.79（用户报②）：**吸收快照里的在途流状态**。中途订阅（重连/窗口重载/切回在跑会话）时
         start 帧早已错过，而快照的 `assistantStream.activeAttempt` 就带着 attemptId+turn/step
         （真机实测：{ revision, activeAttempt: { attemptId, turn, step, nextIndex, stream } }）。
         旧实现完全没读它 ⇒ 后续 chunk 落进 `{turn:0,step:0}` 伪造兜底 ⇒ 合成 `assistant:0:0`
         幻影消息（负 seq ⇒ 排到末尾），而真实结算帧是 `assistant:${turn}:${step}` ⇒ 永不结算
         ⇒ webview 永久停在 .streaming（白块+鲸鱼头像继续呼吸，切会话也不消失）。 */
      const streamState = typeof value.assistantStream === 'object' && value.assistantStream !== null
        ? value.assistantStream as Record<string, unknown>
        : {}
      const active = typeof streamState.activeAttempt === 'object' && streamState.activeAttempt !== null
        ? streamState.activeAttempt as Record<string, unknown>
        : undefined
      if (active !== undefined && typeof active.attemptId === 'string' && active.attemptId !== ''
        && typeof active.turn === 'number' && typeof active.step === 'number') {
        this.attemptTurnStep.set(active.attemptId, { turn: active.turn, step: active.step })
      }
      this.dispatchFrame('mux', { type: 'session/subscribed', sessionId })
      /* 上层收到 subscribed 会清空该会话的 queue/jobs——用 control 流缓存立即回填。 */
      const cachedQueue = this.lastQueueBySession.get(sessionId)
      if (cachedQueue !== undefined) this.dispatchFrame('mux', { type: 'session/queue', sessionId, items: cachedQueue })
      const cachedJobs = this.lastJobsBySession.get(sessionId)
      if (cachedJobs !== undefined) this.dispatchFrame('mux', { type: 'session/jobs', sessionId, jobs: cachedJobs })
      const projections = (typeof value.projections === 'object' && value.projections !== null
        ? value.projections as { asOfSeq?: number; values?: Record<string, unknown> }
        : {})
      for (const [key, entry] of Object.entries(projections.values ?? {})) {
        this.acceptProjection(sessionId, key, entry, projections.asOfSeq)
      }
      const records = Array.isArray(value.records) ? value.records : []
      const pendingApprovals = new Set(this.pendingAskedBySession.get(sessionId) ?? [])
      for (const record of records) {
        const event = record?.event
        if (typeof event?.data?.id !== 'string') continue
        const id = event.data.id as string
        if (event.type === 'approval/asked' && ![...this.pendingEventResults.values()].some(pending => pending.sessionId === sessionId && pending.approvalId === id)) pendingApprovals.add(id)
        else if (event.type === 'approval/decided') {
          pendingApprovals.delete(id)
          for (const [rpcId, pending] of this.pendingEventResults) {
            if (pending.sessionId === sessionId && pending.approvalId === id) this.pendingEventResults.delete(rpcId)
          }
        }
      }
      if (pendingApprovals.size) this.pendingAskedBySession.set(sessionId, [...pendingApprovals])
      else this.pendingAskedBySession.delete(sessionId)
      for (const record of records) {
        const event = (typeof record === 'object' && record !== null ? record as { event?: unknown } : {}).event
        if (typeof event === 'object' && event !== null) {
          /* 0.1.5：view 字段已取消——由转译层从调用参数/结果 meta 合成（变更文件面板依赖）。 */
          const view = synthesizeDiffView(event as DshEvent)
          /* 2026-10-05（D）：标记**补差重放**来源——完成通知的"可信运行态"判据不得被历史事件喂值
             （风暴期每轮重连都会重放含旧 turn/end 的快照，若计入会每轮造出一个假的"已完成"边）。 */
          this.dispatchFrame('mux', { type: 'session/event', sessionId, event, replayed: true, ...(view === undefined ? {} : { view }) })
        }
      }
      return
    }
    if (type === 'event') {
      const event = value.event
      if (typeof event === 'object' && event !== null) {
        const dshEvent = event as { type?: unknown; data?: unknown }
        const evData = (typeof dshEvent.data === 'object' && dshEvent.data !== null ? dshEvent.data : {}) as Record<string, unknown>
        /* 0.1.79（用户报②）：维护"当前未结束的 step"——chunk 帧只有 attemptId，这里是它的兜底锚。 */
        if (dshEvent.type === 'step/start' && typeof evData.turn === 'number' && typeof evData.step === 'number') {
          this.openStepBySession.set(sessionId, { turn: evData.turn, step: evData.step })
        } else if (dshEvent.type === 'step/end' || dshEvent.type === 'turn/end') {
          /* 0.1.84（审查）：turn/end 一并清——异常终止的 step 不会补 step/end，留着陈旧锚会把
             后续"未知 attempt"的 chunk 归到早已结束的那条消息上。 */
          this.openStepBySession.delete(sessionId)
        }
        if (dshEvent.type === 'approval/asked' && typeof evData.id === 'string') {
          /* 暂存未决审批 id：waterfall 帧到达时作为 approvalId（与 approval/decided 同源一致）。 */
          const queue = this.pendingAskedBySession.get(sessionId) ?? []
          if (!queue.includes(evData.id)) queue.push(evData.id)
          this.pendingAskedBySession.set(sessionId, queue)
        } else if (dshEvent.type === 'approval/decided' && typeof evData.id === 'string') {
          for (const [rpcId, pending] of this.pendingEventResults) {
            if (pending.sessionId === sessionId && pending.approvalId === evData.id) this.pendingEventResults.delete(rpcId)
          }
          const remaining = (this.pendingAskedBySession.get(sessionId) ?? []).filter(id => id !== evData.id)
          if (remaining.length) this.pendingAskedBySession.set(sessionId, remaining)
          else this.pendingAskedBySession.delete(sessionId)
          this.dispatchFrame('mux', { type: 'approval/resolved', sessionId, approvalId: evData.id })
        }
        const view = synthesizeDiffView(event as DshEvent)
        this.dispatchFrame('mux', { type: 'session/event', sessionId, event, ...(view === undefined ? {} : { view }) })
      }
      return
    }
    if (type === 'assistant-stream') {
      /* 实时流式（wire 形状实测）：frame.type='start'（带 turn/step/revision）与
         frame.type='chunk'（带 index/time/chunk，chunk 内部与 0.1.1 assistant/chunk 同构）。
         映射回 0.1.1 事件形状 `assistant/chunk`，projector 按 turn:step 归并渲染。 */
      const frame = (typeof value.frame === 'object' && value.frame !== null ? value.frame : {}) as Record<string, unknown>
      const attemptId = typeof frame.attemptId === 'string' ? frame.attemptId : ''
      if (frame.type === 'start') {
        if (attemptId !== '') {
          this.attemptTurnStep.set(attemptId, {
            turn: typeof frame.turn === 'number' ? frame.turn : 0,
            step: typeof frame.step === 'number' ? frame.step : 0,
          })
        }
        return
      }
      if (frame.type === 'end') {
        /* 0.1.79：attempt 结束即撤登记（防表无界增长，也让滞后 chunk 不再命中旧坐标）。
           0.1.84（审查订正）：撤登记后滞后 chunk 仍可能被"当前未结束 step"兜底接住——
           这是**有意**的（落到该 step 的正确消息上）；真正兜住"永久呼吸"的是投影器 turn/end 结算不变量。 */
        if (attemptId !== '') this.attemptTurnStep.delete(attemptId)
        return
      }
      if (frame.type === 'chunk') {
        const chunk = frame.chunk
        if (typeof chunk !== 'object' || chunk === null) return
        let ts = this.attemptTurnStep.get(attemptId)
        if (ts === undefined) {
          /* 0.1.79（用户报②"终止状态不统一"）：**不伪造 turn/step**。旧写法兜底 `{turn:0,step:0}`
             会合成 `assistant:0:0`（负 seq ⇒ 排到对话末尾）而真实结算帧是 `assistant:${turn}:${step}`
             ⇒ 该消息永不结算 ⇒ webview 白块+鲸鱼头像永久呼吸、切会话仍在。
             兜底顺序：① 该会话当前未结束的 step；② 都没有 ⇒ 丢弃本帧（宁缺一段实时文本，不造幻影消息）。 */
          ts = this.openStepBySession.get(sessionId)
          if (ts === undefined) return
        }
        this.attemptTurnStep.set(attemptId, ts)
        this.dispatchFrame('mux', {
          type: 'session/event',
          sessionId,
          event: {
            type: 'assistant/chunk',
            seq: -(++DshClient.chunkSeq),
            time: typeof frame.time === 'number' ? frame.time : Date.now(),
            data: { turn: ts.turn, step: ts.step, chunk },
          },
        })
        return
      }
      return
    }
  }

  openSettingsDocument(): Promise<{ opened: true }> {
    return this.call('settings/openSettingsDocument', { args: {} })
  }

  /** Restore a live approval when opening a tab; history cannot supply an answerable RPC. */
  pendingApproval(sessionId: string): { rpcId: string; approvalId: string; toolName: string; reason?: string } | null {
    if (this.eventClientId === undefined) return null
    for (const [rpcId, pending] of this.pendingEventResults) {
      if (pending.sessionId !== sessionId || pending.clientId !== this.eventClientId || pending.kind !== 'approval'
        || pending.approvalId === undefined || pending.toolName === undefined) continue
      return { rpcId, approvalId: pending.approvalId, toolName: pending.toolName,
        ...(pending.reason === undefined ? {} : { reason: pending.reason }) }
    }
    return null
  }

  listSessions(signal?: AbortSignal): Promise<{ items: SessionSummary[] }> {
    return this.call('session/list', { args: { _request: {} } }, 30_000, signal)
  }

  /** One owned snapshot stream; never switches the active follow or dispatches its records into the UI. */
  async projectionsQuiet(sessionId: string, signal?: AbortSignal): Promise<SessionProjections> {
    await this.ready
    signal?.throwIfAborted()
    this.streamAbort.signal.throwIfAborted()
    if (!this.socketOpen) throw new Error('DSH projection snapshot requires an open connection.')
    const abort = AbortSignal.any([this.streamAbort.signal, AbortSignal.timeout(30_000), ...(signal === undefined ? [] : [signal])])
    return await new Promise<SessionProjections>((resolve, reject) => {
      const streamId = `snapshot-${String(++this.streamCounter)}`
      const onAbort = (): void => { finish(abort.reason as Error) }
      const finish = (error?: Error, value?: SessionProjections): void => {
        if (!this.projectionSnapshots.delete(streamId)) return
        this.streamKinds.delete(streamId)
        abort.removeEventListener('abort', onAbort)
        try { this.sendStreamFrame({ type: 'cancel', streamId }) } catch (cancelError) { this.reportFrameError(cancelError) }
        if (error !== undefined) reject(error)
        else resolve(value!)
      }
      this.projectionSnapshots.set(streamId, finish)
      this.streamKinds.set(streamId, 'snapshot')
      abort.addEventListener('abort', onAbort, { once: true })
      try {
        this.sendStreamFrame({ type: 'open', streamId, endpoint: 'session/follow', payload: {
          args: { request: { address: { kind: 'session', sessionId }, maxMessages: 1 } },
        } })
      } catch (error) { finish(error instanceof Error ? error : new Error(String(error))) }
    })
  }

  /* 0.0.168（B4 反馈）：会话内容全文检索——运行时 sessionQuery 索引（用户/助手消息文本、
     工具调用参数里的文件路径、工具输出、todo）。响应 schema 上限 20 条（宿主截断），
     hasMore 表示还有更多。参数名 request（同 session/create，见 typert 依赖表）。
     超时 90s：部署把索引配成 openAt:first-search 时，**首个搜索要建全量索引**
     （实测 352 会话 ≈ 45s、索引 sqlite ≈ 19MB）——20s 会把首查判死；此后每次查询 ≈ 3s。 */
  searchSessions(query: string, signal?: AbortSignal): Promise<{ items: Array<{ sessionId: string; snippet: string }>; hasMore: boolean }> {
    return this.call('session/search', { args: { request: { query } } }, 90_000, signal)
  }

  createSession(cwd: string): Promise<{ sessionId: string; agentPreset?: string }> {
    return this.call('session/create', { args: { request: { cwd } } })
  }

  /* 0.0.154：分页单次拉取条数。服务端实测**无 100 硬上限**（maxMessages=500 一次返回整个
     2170 事件会话、175ms、hasMore=false）——旧值 100 是客户端自设。"打开即全量"依赖把首屏
     拉取调大（设置 sessionHistory.maxMessages），本常量只作分页回退路径的默认。 */
  private static readonly HISTORY_PAGE_DEFAULT = 500

  /* 0.0.171（用户反馈："搜索时会话来回跳，好像创建了新对话"）：**静默**历史拉取——
     history() 会 ensureFollowStream（切换会话=关旧流开新流），后台索引逐会话拉取时会
     把 follow 流一路抢走 → 视图跟着跳。本方法不动任何流，走 throughSeq 探测回退路径
     （首查被 "past cursor N" 拒后按 N 重试，多一次 RPC，仅后台索引用）。 */
  async historyQuiet(sessionId: string, maxMessages?: number, beforeSeq?: number, signal?: AbortSignal): Promise<{ events: HistoryEntry[]; hasMore: boolean }> {
    const limit = typeof maxMessages === 'number' && Number.isFinite(maxMessages) && maxMessages > 0
      ? Math.min(20_000, Math.max(1, Math.round(maxMessages)))
      : DshClient.HISTORY_PAGE_DEFAULT
    /* 0.1.125（数据层根治·真机反例）：支持 beforeSeq 游标——轨道表"多页补拉到全会话"用
       （单页被服务端截到 ~1.3 万事件，只靠首页 ⇒ 表只有尾部）。语义与 history() 同：
       throughSeq 先以极大值探测、被 "past cursor N" 拒后按 N 重试；beforeSeq 锚点透传。 */
    const through = beforeSeq === undefined ? Number.MAX_SAFE_INTEGER : (this.cursorBySession.get(sessionId) ?? Number.MAX_SAFE_INTEGER)
    try {
      return await this.fetchPage(sessionId, through, beforeSeq, limit, signal)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const match = /past cursor\s+(\d+)/.exec(message)
      if (match === null) throw error
      const cursor = Number(match[1])
      this.cursorBySession.set(sessionId, cursor)
      return await this.fetchPage(sessionId, cursor, beforeSeq, limit, signal)
    }
  }

  private async fetchPage(sessionId: string, throughSeq: number, beforeSeq: number | undefined, maxMessages: number, signal?: AbortSignal): Promise<{
    events: HistoryEntry[]
    hasMore: boolean
  }> {
    const result = await this.callRead<{ records?: Array<{ event: DshEvent }>; hasMore?: boolean }>('session/page', {
      args: {
        request: {
          address: { kind: 'session', sessionId },
          throughSeq,
          ...(beforeSeq === undefined ? {} : { beforeSeq }),
          maxMessages,
        },
      },
    }, 30_000, signal)
    return {
      events: (result.records ?? []).map(record => {
        const view = synthesizeDiffView(record.event)
        return view === undefined ? { event: record.event } : { event: record.event, view }
      }),
      hasMore: result.hasMore === true,
    }
  }

  /* 0.0.70：尾页（无 beforeSeq）响应携带投影基线 block——冷会话的 session.list 行没有
     投影块，切会话时用量行/圆环会概率性缺失，靠它回填。
     0.1.5：投影基线迁移到 session/follow 快照（批次 2 恢复回填；本批次保留字段以防 undefined）。
     throughSeq 语义（0.1.5）= 页右界，须 ≤ 会话当前游标；首查以极大值探测，被拒时从
     "past cursor N" 解析真实游标并按会话缓存（批次 2 起改为从 follow 快照 cursor 直接取得）。 */
  async history(sessionId: string, beforeSeq?: number, maxMessages?: number): Promise<{
    events: HistoryEntry[]
    hasMore: boolean
    projections?: { asOfSeq?: number; values?: Record<string, unknown> }
  }> {
    this.ensureFollowStream(sessionId)
    const limit = typeof maxMessages === 'number' && Number.isFinite(maxMessages) && maxMessages > 0
      ? Math.min(20_000, Math.max(1, Math.round(maxMessages)))
      : DshClient.HISTORY_PAGE_DEFAULT
    const cached = this.cursorBySession.get(sessionId)
    /* 首屏（无 beforeSeq）不信任缓存：会话可能在"切走期间"继续增长（跑着被切走再切回），
       过期右界会取到旧页。翻页才用缓存（beforeSeq 锚点固定，右界陈旧无害）。 */
    const through = beforeSeq === undefined ? Number.MAX_SAFE_INTEGER : (cached ?? Number.MAX_SAFE_INTEGER)
    try {
      const result = await this.fetchPage(sessionId, through, beforeSeq, limit)
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const match = /past cursor\s+(\d+)/.exec(message)
      if (match === null) throw error
      const cursor = Number(match[1])
      this.cursorBySession.set(sessionId, cursor)
      return this.fetchPage(sessionId, cursor, beforeSeq, limit)
    }
  }

  /* 0.1.5：session/modelCatalog 无入参；current 语义近似取 default（批量验收时实测核对）。 */
  async models(_sessionId: string): Promise<SessionModels> {
    const result = await this.call<{
      default?: ModelSelection
      routableProviders?: string[]
      groups?: SessionModels['groups']
      failures?: SessionModels['failures']
    }>('session/modelCatalog', { args: {} })
    return {
      current: result.default ?? { provider: '', model: '' },
      routable: (result.routableProviders?.length ?? 0) > 0,
      groups: result.groups ?? [],
      failures: result.failures ?? [],
    }
  }

  attachment(sessionId: string, attachmentId: string, signal?: AbortSignal): Promise<{ attachment: ImageAttachment; data: string }> {
    return this.call('session/attachment', { args: { request: { sessionId, attachmentId } } }, 30_000, signal)
  }

  pluginInventory(): Promise<PluginInventorySnapshot> {
    return this.call('pluginInventory/list', { args: {} })
  }

  settings(): Promise<SettingsDescription> {
    return this.callRead('settings/describe', { args: {} })
  }

  permissionCatalog(): Promise<unknown> {
    return this.callRead('permissionPresets/catalog', { args: {} })
  }

  configurableProviders(): Promise<ConfigurableProvider[]> {
    return this.call('llm/listConfigurableProviders', { args: {} })
  }

  describeCredentials(refs: string[]): Promise<Record<string, CredentialInfo>> {
    return this.call('credentials/describe', { args: { refs } })
  }

  setCredential(ref: string, value: string): Promise<void> {
    return this.call('credentials/set', { args: { ref, value } })
  }

  unsetCredential(ref: string): Promise<void> {
    return this.call('credentials/unset', { args: { ref } })
  }

  discoverModels(settingsNs: string, request: ModelDiscoveryRequest): Promise<DiscoveredModel[]> {
    return this.call('llm/discoverModels', { args: { settingsNs, request } })
  }

  mutateSettings(ns: string, ops: SettingsMutation[], expectedRevision: number): Promise<SettingsNamespace> {
    return this.call('settings/mutate', { args: { ns, ops, expectedRevision } })
  }

  /* 0.0.76：turn-rewind（第三方插件 @anionex/dsh-turn-rewind 的**同源 HTTP 端点**，
     非官方 API 直读原始响应；解析与文案在 turn-rewind.ts）。 */
  async turnRewindPreview(sessionId: string, messageSeq: number): Promise<{ httpStatus: number; body: unknown }> {
    await this.ready
    const url = new URL('/turn-rewind', this.baseUrl)
    url.searchParams.set('sessionId', sessionId)
    url.searchParams.set('messageSeq', String(messageSeq))
    url.searchParams.set('limit', '50')
    const response = await fetch(url, { headers: this.authHeaders(), signal: AbortSignal.timeout(15_000) })
    let body: unknown
    try { body = await response.json() } catch { body = undefined }
    return { httpStatus: response.status, body }
  }

  async turnRewindApply(payload: {
    mode: 'code' | 'both'
    sessionId: string
    messageSeq: number
    checkpointId: string
    planId: string
    confirmation: string
  }): Promise<{ httpStatus: number; body: unknown }> {
    await this.ready
    const response = await fetch(new URL('/turn-rewind', this.baseUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...this.authHeaders() },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(120_000),
    })
    let body: unknown
    try { body = await response.json() } catch { body = undefined }
    return { httpStatus: response.status, body }
  }

  /* C3 v1.2（0.0.130）：dsh-context ≥ v0.9（插件 0.52.x）把重集合（nodes/requests/events/
     archive/fileOps）从投影挪到按需通道——投影只发「轻头」（这些字段恒为空数组，含 detailRev），
     明细走 POST /api/dsh-context/detail。返回体形如 { ok: true, value: { rev, requests, … } }。 */
  async contextDetail(sessionId: string): Promise<unknown> {
    await this.ready
    const response = await fetch(new URL('/api/dsh-context/detail', this.baseUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...this.authHeaders() },
      body: JSON.stringify({ sessionId }),
      signal: AbortSignal.timeout(15_000),
    })
    let body: unknown
    try { body = await response.json() } catch { body = undefined }
    return body
  }

  async prompt(
    sessionId: string,
    text: string,
    images: readonly PromptImage[] = [],
    mode: PromptMode = 'queue',
    signal?: AbortSignal,
  ): Promise<{ accepted: true; rpcId: string }> {
    const content: Array<{ type: 'text'; text: string } | PromptImage> = images.map(image => ({
      type: 'image',
      mediaType: image.mediaType,
      data: image.data,
      ...(image.name === undefined ? {} : { name: image.name }),
    }))
    if (text !== '') content.push({ type: 'text', text })
    // Runtime echoes requestId as message.source.rpcId, including queued messages.
    // The transport RPC id identifies only this HTTP call and cannot match the queue.
    const requestId = randomUUID()
    await this.call<{ accepted: true }>('session/prompt', {
      args: {
        request: {
          requestId,
          sessionId,
          mode,
          content,
          clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
      },
    }, 30_000, signal)
    return { accepted: true, rpcId: requestId }
  }

  /* 0.1.5：审批/提问应答改走 RPC `$events/result`（waterfall 结算）。
     上层 value 形状沿用旧契约并在此解包：
       - 审批：{sessionId, approvalId, outcome:'allowed-once'|'rejected'} → outcome 值=该字符串
       - 提问：{sessionId, answer:{answers:[{id, selected, custom?}]}} → outcome 值=answer 对象 */
  async respond(rpcId: string, value: unknown): Promise<RpcReceipt> {
    const pending = this.pendingEventResults.get(rpcId)
    if (pending === undefined) throw new Error('This request has already been answered.')
    if (pending.kind === 'approval' && pending.clientId !== this.eventClientId) {
      throw new Error('审批连接正在恢复，请等待卡片刷新后重新确认；本次决定尚未提交。')
    }
    const record = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>
    const outcomeValue = pending.kind === 'approval' ? record['outcome'] : record['answer']
    await this.call('$events/result', {
      args: {
        clientId: pending.clientId,
        eventId: pending.eventId,
        outcome: { kind: 'result', value: outcomeValue },
      },
    })
    this.pendingEventResults.delete(rpcId)
    return { accepted: true }
  }

  /** 0.0.106（W2 提问「跳过」）：审批以官方 outcome 值 `cancelled` 结算；
      提问以 rejected 结算（与服务端把等待中的工具调用判为已取消的语义一致）。 */
  async respondCancelled(rpcId: string): Promise<RpcReceipt> {
    const pending = this.pendingEventResults.get(rpcId)
    if (pending === undefined) throw new Error('This request has already been answered.')
    if (pending.kind === 'approval') {
      await this.call('$events/result', {
        args: {
          clientId: pending.clientId,
          eventId: pending.eventId,
          outcome: { kind: 'result', value: 'cancelled' },
        },
      })
    } else {
      await this.call('$events/result', {
        args: {
          clientId: pending.clientId,
          eventId: pending.eventId,
          outcome: {
            kind: 'rejected',
            error: { name: 'UserQuestionCancelled', message: 'the user closed this question request' },
          },
        },
      })
    }
    this.pendingEventResults.delete(rpcId)
    return { accepted: true }
  }

  cancel(sessionId: string): Promise<{ accepted: true }> {
    return this.call('session/cancel', { args: { request: { sessionId } } })
  }

  updateQueue(sessionId: string, itemId: string, action: QueueAction): Promise<{ accepted: true }> {
    return this.call('session/updateQueue', { args: { request: { sessionId, itemId, action } } })
  }

  selectModel(sessionId: string, selection: ModelSelection): Promise<{ selected: ModelSelection }> {
    return this.call('session/selectModel', { args: { request: { sessionId, ...selection } } })
  }

  listCommands(sessionId: string): Promise<CommandDescriptor[]> {
    return this.call('commands/list', { args: { agentId: sessionId } }, 10_000)
  }

  async listSkills(sessionId: string): Promise<SkillDescriptor[]> {
    const result = await this.call<{ skills: SkillDescriptor[] }>('skills/list', { args: { request: { sessionId } } }, 10_000)
    return result.skills
  }

  async listAgentPresets(): Promise<AgentPresetRoster> {
    return this.call<AgentPresetRoster>('agentPresets/list', { args: {} }, 10_000)
  }

  async selectAgentPreset(sessionId: string, agentPreset: string): Promise<{ agentPreset: string }> {
    /* 0.1.5：返回裸 preset id（旧版为 {agentPreset} 对象）。 */
    const result = await this.call<string>('agentPresets/select', { args: { agentId: sessionId, agentPreset } }, 30_000)
    return { agentPreset: result }
  }

  executeCommand(
    sessionId: string,
    line: string,
    images?: readonly PromptImage[],
  ): Promise<CommandExecution | undefined> {
    return this.call('commands/execute', {
      args: {
        agentId: sessionId,
        line,
        /* 0.1.5：descriptor 要求该字段恒在（无图片时传空数组）。 */
        submittedAttachments: (images ?? []).map(image => ({
          type: 'image',
          mediaType: image.mediaType,
          data: image.data,
          ...(image.name === undefined ? {} : { name: image.name }),
        })),
      },
    }, 300_000)
  }

  /** Disk trash has no runtime delete RPC. Ignore its stale control traffic until restored/followed. */
  forgetSession(sessionId: string): void {
    this.forgottenSessions.add(sessionId)
    this.cursorBySession.delete(sessionId)
    this.lastQueueBySession.delete(sessionId)
    this.projectionSequences.delete(sessionId)
    this.lastJobsBySession.delete(sessionId)
    this.pendingAskedBySession.delete(sessionId)
    for (const [id, pending] of this.pendingEventResults) if (pending.sessionId === sessionId) this.pendingEventResults.delete(id)
    if (this.followSessionId !== sessionId) return
    this.closeJobsStream()
    if (this.followStreamId !== undefined) {
      this.sendStreamFrame({ type: 'cancel', streamId: this.followStreamId })
      this.streamKinds.delete(this.followStreamId)
      this.followSessionByStream.delete(this.followStreamId)
    }
    this.followStreamId = undefined
    this.followSessionId = undefined
    this.attemptTurnStep.clear()
    this.openStepBySession.clear()
  }

  dispose(): void {
    this.disposed = true
    this.streamAbort.abort()
    if (this.reconnectTimer !== undefined) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = undefined
    }
    this.stopLiveness()
    for (const finish of [...this.projectionSnapshots.values()]) finish(new Error('DSH client disposed.'))
    this.socket?.close()
    this.socket = undefined
    this.closeJobsStream()
    this.streamKinds.clear()
    this.followSessionByStream.clear()
    this.followStreamId = undefined
    this.followSessionId = undefined
    this.attemptTurnStep.clear()
    this.openStepBySession.clear()
    this.cursorBySession.clear()
    this.lastQueueBySession.clear()
    this.projectionSequences.clear()
    this.lastJobsBySession.clear()
    this.forgottenSessions.clear()
    this.pendingAskedBySession.clear()
    this.pendingEventResults.clear()
    this.frameListeners.clear()
    this.errorListeners.clear()
    this.frameErrorListeners.clear()
    this.diagListeners.clear()
  }

  /* 冷大纲计算期间，设置和分页只读 RPC 实测连接重置。最多一次，且共用原截止时间。
     写入/发送继续使用 call；业务/HTTP/超时错误、取消或 dispose 均不重放。 */
  private async callRead<T>(method: string, payload: unknown, timeoutMs = 30_000, signal?: AbortSignal): Promise<T> {
    const started = Date.now()
    try {
      return await this.call<T>(method, payload, timeoutMs, signal)
    } catch (error) {
      const cause = error instanceof Error ? error.cause : undefined
      const code = typeof cause === 'object' && cause !== null ? (cause as { code?: unknown }).code : undefined
      const remainingMs = timeoutMs - (Date.now() - started)
      if ((code !== 'ECONNRESET' && code !== 'UND_ERR_SOCKET') || remainingMs <= 0 || signal?.aborted || this.streamAbort.signal.aborted) throw error
      return this.call<T>(method, payload, remainingMs, signal)
    }
  }

  private async call<T>(method: string, payload: unknown, timeoutMs = 30_000, signal?: AbortSignal): Promise<T> {
    return (await this.callDetailed<T>(method, payload, timeoutMs, signal)).value
  }

  /* 0.0.59：同 call，但把本次请求的 rpcId 一并带回——发送方需要它来追踪队列项
     （stop 时判断消息是否已被运行时消费）。
     0.1.5：随请求携带 dsh-auth-* cookie（认证层改造）。 */
  private async callDetailed<T>(method: string, payload: unknown, timeoutMs = 30_000, signal?: AbortSignal): Promise<{ value: T; rpcId: string }> {
    await this.ready
    signal?.throwIfAborted()
    const rpcId = randomUUID()
    const response = await fetch(new URL(`/api/${method}`, this.baseUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...this.authHeaders() },
      body: JSON.stringify({ type: 'client-request', rpcId, method, payload }),
      signal: signal === undefined ? AbortSignal.timeout(timeoutMs) : AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
    })
    if (!response.ok) throw new Error(`DSH transport failed: HTTP ${String(response.status)}`)
    const envelope = await response.json() as RpcEnvelope<T>
    if (envelope.type !== 'server-response' || envelope.rpcId !== rpcId) {
      throw new Error(`Invalid DSH response for ${method}.`)
    }
    if (!envelope.result.ok) {
      throw new DshRpcError(envelope.result.error, method)
    }
    return { value: envelope.result.value, rpcId }
  }
}

/* 2026-10-05（真机事故）：可重试判定——提取自提交兜底路径（question-park 状态机）。
   "可重试" = 连接/流生命周期类失败（应答换个活流即可送达）；**业务校验错误不在其列**
   （如参数非法、认证失败——重试无意义，照旧冒泡成用户可见报错）。
   真机取证：网关对已死流的原话 = "typert gateway: Remote event result identifies no active event stream"
   （dsh-api-gateway dispatchRpc 查 remoteEventClients 未命中）。 */
export function isRetryableAnswerError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  if (message.includes('no active event stream')) return true
  if (message.includes('fetch failed')) return true
  if (/DSH transport failed: HTTP 5\d\d/.test(message)) return true
  if (message.includes('aborted due to timeout')) return true
  if (message.includes('socket is closed')) return true
  return false
}
