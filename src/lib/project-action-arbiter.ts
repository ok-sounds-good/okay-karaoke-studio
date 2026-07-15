export const PROJECT_ACTION_KINDS = [
  'new',
  'open',
  'save',
  'save-as',
  'export',
  'import-audio',
  'import-lrc',
  'undo',
  'redo',
  'native-close',
] as const

export type ProjectActionKind = (typeof PROJECT_ACTION_KINDS)[number]
export type ProjectActionSource = 'ui' | 'menu' | 'native'
export type NativeCloseScope = 'window' | 'app'
export type DraftDecision = 'apply' | 'discard'
export type ProjectActionPhase =
  | 'idle'
  | 'awaiting-draft-decision'
  | 'settling-draft'
  | 'canceling-native'
  | 'awaiting-render'
  | 'authorizing-native'
  | 'awaiting-native-retry'

export interface NativeProjectActionRequest {
  kind: 'native-close'
  source: 'native'
  nativeRequestId: string
  nativeScope: NativeCloseScope
}

export type ProjectActionRequest =
  | {
      kind: Exclude<ProjectActionKind, 'native-close'>
      source: Exclude<ProjectActionSource, 'native'>
    }
  | NativeProjectActionRequest

export interface ProjectActionState {
  phase: ProjectActionPhase
  pending: ProjectActionRequest | null
  error: string | null
  renderBarrier: number | null
}

type MaybePromise<T> = T | Promise<T>

export type ProjectActionExecutors = Record<
  ProjectActionKind,
  (request: ProjectActionRequest) => MaybePromise<unknown>
>

export interface ProjectActionDraftGuard {
  needsResolution(request: ProjectActionRequest): boolean
  settle(decision: DraftDecision, request: ProjectActionRequest): MaybePromise<boolean>
}

interface ProjectActionRuntime {
  getGuard(): ProjectActionDraftGuard | undefined
  execute(request: ProjectActionRequest): MaybePromise<unknown>
  cancelNative(requestId: string): Promise<boolean>
  getPendingNative?(): Promise<NativeProjectActionRequest | null>
}

export interface ProjectActionCoordinator {
  getState(): ProjectActionState
  request(request: ProjectActionRequest): void
  settle(decision: DraftDecision): void
  keep(): void
  crossRenderBarrier(renderBarrier: number): void
}

interface Cancellation {
  requestId: string
  replacement: ProjectActionRequest | null
  keepDraft: boolean
}

interface ActionOwner {
  request: ProjectActionRequest
  queuedNative: NativeProjectActionRequest | null
  settling: boolean
  settled: boolean
  cancellation: Cancellation | null
  renderBarrier: number | null
  authorizing: boolean
  reconciling: boolean
  keepNative: boolean
  error: string | null
}

export const INITIAL_PROJECT_ACTION_STATE: ProjectActionState = Object.freeze({
  phase: 'idle',
  pending: null,
  error: null,
  renderBarrier: null,
})

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message.trim() ? error.message : fallback
}

function isSameNativeRequest(left: ProjectActionRequest, right: ProjectActionRequest) {
  return (
    left.kind === 'native-close' &&
    right.kind === 'native-close' &&
    left.nativeRequestId === right.nativeRequestId
  )
}

export function createProjectActionCoordinator(
  runtime: ProjectActionRuntime,
  onStateChange: (state: ProjectActionState) => void,
): ProjectActionCoordinator {
  let owner: ActionOwner | null = null
  let nextRenderBarrier = 0

  const stateForOwner = (): ProjectActionState => {
    if (!owner) return INITIAL_PROJECT_ACTION_STATE
    const phase: ProjectActionPhase =
      owner.authorizing || owner.reconciling
        ? 'authorizing-native'
        : owner.cancellation
          ? 'canceling-native'
          : owner.settling
            ? 'settling-draft'
            : owner.renderBarrier !== null
              ? 'awaiting-render'
              : owner.settled && owner.request.kind === 'native-close'
                ? 'awaiting-native-retry'
                : 'awaiting-draft-decision'
    return {
      phase,
      pending: owner.request,
      error: owner.error,
      renderBarrier: owner.renderBarrier,
    }
  }

  const publish = () => onStateChange(stateForOwner())

  const clear = () => {
    owner = null
    publish()
  }

  const retainAuthorization = (owned: ActionOwner, error: unknown) => {
    if (owner !== owned) return
    owned.authorizing = false
    owned.reconciling = false
    owned.error = errorMessage(error, 'The native close request could not be authorized.')
    publish()
  }

  const reconcileAuthorization = (owned: ActionOwner, attempted: NativeProjectActionRequest) => {
    const query = runtime.getPendingNative
    if (!query) {
      retainAuthorization(owned, new Error('Unable to verify the native close request.'))
      return
    }
    owned.authorizing = false
    owned.reconciling = true
    publish()
    void query().then(
      (pending) => {
        if (owner !== owned) return
        owned.reconciling = false
        const confirmed = owned.queuedNative ?? pending
        owned.queuedNative = null
        if (!confirmed) {
          clear()
          return
        }
        owned.request = confirmed
        owned.error = null
        if (owned.keepNative) startCancellation(owned, null, true)
        else startAuthorization(owned, false)
      },
      (error) => retainAuthorization(owned, error),
    )
  }

  const startAuthorization = (owned: ActionOwner, mayReconcile = true) => {
    owned.authorizing = owned.request.kind === 'native-close'
    owned.reconciling = false
    owned.renderBarrier = null
    if (owned.authorizing) publish()

    let result: MaybePromise<unknown>
    try {
      result = runtime.execute(owned.request)
    } catch (error) {
      if (owned.request.kind === 'native-close') {
        if (mayReconcile) reconcileAuthorization(owned, owned.request)
        else retainAuthorization(owned, error)
      } else if (owner === owned) clear()
      return
    }

    if (!owned.authorizing) {
      if (owner === owned) clear()
      void Promise.resolve(result).catch(() => undefined)
      return
    }

    const attempted = owned.request as NativeProjectActionRequest
    const finish = (acknowledged: unknown, error?: unknown) => {
      if (owner !== owned) return
      if (acknowledged !== true && owned.queuedNative) {
        owned.request = owned.queuedNative
        owned.queuedNative = null
        owned.authorizing = false
        if (owned.keepNative) startCancellation(owned, null, true)
        else startAuthorization(owned)
        return
      }
      if (acknowledged === true) clear()
      else if (mayReconcile) reconcileAuthorization(owned, attempted)
      else
        retainAuthorization(owned, error ?? new Error('The native close request remains active.'))
    }
    void Promise.resolve(result).then(finish, (error) => finish(false, error))
  }

  const waitForRender = (owned: ActionOwner) => {
    if (owner !== owned || owned.settling || owned.cancellation || !owned.settled) return
    owned.renderBarrier = ++nextRenderBarrier
    owned.error = null
    publish()
  }

  const failCancellation = (owned: ActionOwner, cancellation: Cancellation, error: unknown) => {
    if (owner !== owned || owned.cancellation !== cancellation) return
    owned.cancellation = null
    owned.error = errorMessage(error, 'The native close request could not be canceled.')
    publish()
  }

  const startCancellation = (
    owned: ActionOwner,
    replacement: ProjectActionRequest | null,
    keepDraft: boolean,
  ) => {
    if (owned.request.kind !== 'native-close' || owned.authorizing) return
    owned.keepNative = keepDraft
    if (owned.cancellation) {
      owned.cancellation.replacement = replacement
      owned.cancellation.keepDraft = keepDraft
      publish()
      return
    }

    const cancellation: Cancellation = {
      requestId: owned.request.nativeRequestId,
      replacement,
      keepDraft,
    }
    owned.cancellation = cancellation
    owned.renderBarrier = null
    owned.error = null
    publish()
    void runtime.cancelNative(cancellation.requestId).then(
      (acknowledged) => {
        if (!acknowledged) {
          failCancellation(
            owned,
            cancellation,
            new Error('The native close request remains active.'),
          )
          return
        }
        if (owner !== owned || owned.cancellation !== cancellation) return
        owned.cancellation = null
        if (cancellation.keepDraft) {
          clear()
          return
        }
        if (!cancellation.replacement) {
          publish()
          return
        }
        owned.request = cancellation.replacement
        owned.error = null
        waitForRender(owned)
        if (owned.renderBarrier === null) publish()
      },
      (error) => failCancellation(owned, cancellation, error),
    )
  }

  const executeUnguarded = (request: ProjectActionRequest) => {
    const owned: ActionOwner = {
      request,
      queuedNative: null,
      settling: false,
      settled: true,
      cancellation: null,
      renderBarrier: null,
      authorizing: false,
      reconciling: false,
      keepNative: false,
      error: null,
    }
    if (request.kind === 'native-close') owner = owned
    startAuthorization(owned)
  }

  const request = (request: ProjectActionRequest) => {
    if (!owner) {
      let guarded = false
      try {
        guarded = runtime.getGuard()?.needsResolution(request) === true
      } catch (error) {
        owner = {
          request,
          queuedNative: null,
          settling: false,
          settled: false,
          cancellation: null,
          renderBarrier: null,
          authorizing: false,
          reconciling: false,
          keepNative: false,
          error: errorMessage(error, 'Unable to inspect the pending edit.'),
        }
        publish()
        return
      }
      if (!guarded) {
        executeUnguarded(request)
        return
      }
      owner = {
        request,
        queuedNative: null,
        settling: false,
        settled: false,
        cancellation: null,
        renderBarrier: null,
        authorizing: false,
        reconciling: false,
        keepNative: false,
        error: null,
      }
      publish()
      return
    }

    if (owner.authorizing || owner.reconciling) {
      if (request.kind === 'native-close' && !isSameNativeRequest(owner.request, request)) {
        owner.queuedNative = request
      }
      return
    }
    if (owner.keepNative && request.kind === 'native-close') {
      owner.request = request
      owner.queuedNative = null
      owner.renderBarrier = null
      owner.error = null
      startCancellation(owner, null, true)
      return
    }
    if (isSameNativeRequest(owner.request, request)) {
      if (owner.settled && owner.error) {
        owner.error = null
        startAuthorization(owner)
      }
      return
    }
    if (request.kind === 'native-close') {
      owner.request = request
      owner.cancellation = null
      owner.renderBarrier = null
      owner.error = null
      waitForRender(owner)
      if (owner.renderBarrier === null) publish()
      return
    }
    if (owner.request.kind === 'native-close') {
      startCancellation(owner, request, false)
      return
    }
    owner.request = request
    owner.renderBarrier = null
    owner.error = null
    waitForRender(owner)
    if (owner.renderBarrier === null) publish()
  }

  const settle = (decision: DraftDecision) => {
    const owned = owner
    if (!owned || owned.authorizing || owned.settling || owned.settled) return
    const guard = runtime.getGuard()
    if (!guard) return

    owned.settling = true
    owned.error = null
    publish()
    let result: MaybePromise<boolean>
    try {
      result = guard.settle(decision, owned.request)
    } catch (error) {
      owned.settling = false
      owned.error = errorMessage(error, 'The pending edit could not be settled.')
      publish()
      return
    }
    void Promise.resolve(result).then(
      (settled) => {
        if (owner !== owned) return
        owned.settling = false
        if (!settled) {
          owned.error = 'The pending edit could not be settled.'
          publish()
          return
        }
        owned.settled = true
        waitForRender(owned)
        if (owned.renderBarrier === null) publish()
      },
      (error) => {
        if (owner !== owned) return
        owned.settling = false
        owned.error = errorMessage(error, 'The pending edit could not be settled.')
        publish()
      },
    )
  }

  const keep = () => {
    if (!owner || owner.settling) return
    if (owner.request.kind === 'native-close') {
      owner.keepNative = true
      if (owner.authorizing || owner.reconciling) return
      startCancellation(owner, null, true)
      return
    }
    clear()
  }

  const crossRenderBarrier = (renderBarrier: number) => {
    const owned = owner
    if (!owned || owned.renderBarrier !== renderBarrier || owned.authorizing) return
    startAuthorization(owned)
  }

  return { getState: stateForOwner, request, settle, keep, crossRenderBarrier }
}
