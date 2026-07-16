import type {
  ProjectActionKind,
  ProjectActionPhase,
  ProjectActionRequest,
} from '../lib/project-action-arbiter'
import { Button, Modal } from './ui'

interface ProjectActionDecisionDialogProps {
  request: ProjectActionRequest
  phase: ProjectActionPhase
  error: string | null
  hasDraft: boolean
  onApply: () => void
  onDiscard: () => void
  onKeep: () => void
}

const ACTION_DESCRIPTIONS = {
  new: 'start a new project',
  open: 'open another project',
  save: 'save the project',
  'save-as': 'save a new project copy',
  export: 'open Export',
  'import-audio': 'attach or replace the backing track',
  'import-lrc': 'import lyrics into the active track',
  undo: 'undo the latest project change',
  redo: 'redo the next project change',
} satisfies Record<Exclude<ProjectActionKind, 'native-close'>, string>

function actionDescription(request: ProjectActionRequest) {
  return request.kind === 'native-close'
    ? request.nativeScope === 'app'
      ? 'quit the Studio'
      : 'close this window'
    : ACTION_DESCRIPTIONS[request.kind]
}

const PROGRESS_MESSAGES: Partial<Record<ProjectActionPhase, string>> = {
  'settling-draft': 'Finishing the Style edit…',
  'canceling-native': 'Keeping the Studio open…',
  'awaiting-render': 'Preparing the project action…',
  'authorizing-native': 'Confirming the close request…',
  'awaiting-native-retry': 'The close request is still pending. Keep editing to cancel it.',
}

export function ProjectActionDecisionDialog({
  request,
  phase,
  error,
  hasDraft,
  onApply,
  onDiscard,
  onKeep,
}: ProjectActionDecisionDialogProps) {
  const canDecide = phase === 'awaiting-draft-decision' && hasDraft
  const canKeep = phase === 'awaiting-draft-decision' || phase === 'awaiting-native-retry'
  const progress = PROGRESS_MESSAGES[phase] ?? null

  return (
    <Modal
      title="Finish editing project Style?"
      eyebrow="Project Style changes"
      onClose={onKeep}
      closeDisabled={!canKeep}
      footer={
        <>
          <Button autoFocus variant="ghost" disabled={!canKeep} onClick={onKeep}>
            Keep editing
          </Button>
          <Button variant="secondary" disabled={!canDecide} onClick={onDiscard}>
            Discard changes
          </Button>
          <Button variant="primary" disabled={!canDecide} onClick={onApply}>
            Apply changes
          </Button>
        </>
      }
    >
      <div className="project-action-decision">
        <p>Resolve the open project Style edit before you {actionDescription(request)}.</p>
        {progress && <p role="status">{progress}</p>}
        {error && <p role="alert">{error}</p>}
      </div>
    </Modal>
  )
}
