/** bug⑧: 附带开关开启时主动把当前活动文件置入附带单槽——侧栏打开/开关重开时没有
    activeFile change 事件，`__attached__` 槽不会自动创建，需显式触发。 */
export interface AttachBridge {
  viewState(): { activeFile?: { path: string } }
  attachActiveFile(relativePath: string): void
}

export function attachActiveFileIfNeeded(bridge: AttachBridge, includeOn: boolean): void {
  if (!includeOn) return
  const state = bridge.viewState()
  if (state.activeFile === undefined) return
  bridge.attachActiveFile(state.activeFile.path)
}