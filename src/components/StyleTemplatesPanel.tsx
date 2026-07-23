import { useEffect, useMemo, useRef, useState } from 'react'
import type { ProjectStyleDraft, ProjectStyleSession } from '../hooks/useProjectStyleSession'
import type { StyleTemplateBackgroundPreparationResult } from '../hooks/useBackgroundImageStyleSession'
import {
  captureStyleTemplatePreferences,
  loadStyleTemplateIntoDraft,
} from '../lib/style-template-workflow'
import type { StyleTemplate } from '../lib/style-template-codec'
import { Button } from './ui'

interface StyleTemplatesPanelProps {
  active: boolean
  id: string
  labelledBy: string
  draft: ProjectStyleDraft
  onDraftChange: ProjectStyleSession['change']
  onPrepareTemplateBackground?: (
    templateId: string | null,
  ) => Promise<StyleTemplateBackgroundPreparationResult>
}

function errorMessage(error: unknown) {
  return error instanceof Error && error.message.trim()
    ? error.message
    : 'The template library could not be updated.'
}

export function StyleTemplatesPanel({
  active,
  id,
  labelledBy,
  draft,
  onDraftChange,
  onPrepareTemplateBackground,
}: StyleTemplatesPanelProps) {
  const [templates, setTemplates] = useState<StyleTemplate[] | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [newName, setNewName] = useState('')
  const [renameName, setRenameName] = useState('')
  const [busy, setBusy] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const restoreDeleteFocus = useRef(false)
  const deleteButtonId = `${id}-delete-template`

  const reload = async () => {
    if (!window.studio?.listStyleTemplates) {
      setTemplates([])
      setLoadFailed(true)
      setError('Saved templates are available in the desktop app.')
      return
    }
    setBusy(true)
    setLoadFailed(false)
    setError(null)
    setStatus(null)
    try {
      const next = await window.studio.listStyleTemplates()
      setTemplates(next)
      setSelectedId((current) =>
        current && next.some(({ id: value }) => value === current)
          ? current
          : (next[0]?.id ?? null),
      )
    } catch (cause) {
      setError(errorMessage(cause))
      setLoadFailed(true)
      setTemplates([])
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (active && templates === null) void reload()
  }, [active, templates])

  const visible = useMemo(
    () =>
      (templates ?? []).filter(({ name: templateName }) =>
        templateName.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
      ),
    [query, templates],
  )
  const selected = (templates ?? []).find(({ id: value }) => value === selectedId) ?? null

  useEffect(() => {
    setRenameName(selected?.name ?? '')
  }, [selected?.id, selected?.name])

  useEffect(() => {
    if (confirmingDelete || !restoreDeleteFocus.current) return
    restoreDeleteFocus.current = false
    document.getElementById(deleteButtonId)?.focus()
  }, [confirmingDelete, deleteButtonId])

  const closeDeleteConfirmation = () => {
    restoreDeleteFocus.current = true
    setConfirmingDelete(false)
  }

  const create = async () => {
    if (!window.studio?.createStyleTemplate || !newName.trim()) return
    setBusy(true)
    setError(null)
    setStatus(null)
    try {
      const created = await window.studio.createStyleTemplate({
        name: newName,
        preferences: captureStyleTemplatePreferences(draft),
      })
      setTemplates((current) => [...(current ?? []), created])
      setSelectedId(created.id)
      setNewName('')
      setStatus(`Saved “${created.name}”.`)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }
  const rename = async () => {
    if (!window.studio?.renameStyleTemplate || !selected || !renameName.trim()) return
    const selectedTemplate = selected
    setBusy(true)
    setError(null)
    setStatus(null)
    try {
      const renamed = await window.studio.renameStyleTemplate(selectedTemplate.id, renameName)
      setTemplates((current) =>
        (current ?? []).map((value) => (value.id === renamed.id ? renamed : value)),
      )
      setStatus(`Renamed template to “${renamed.name}”.`)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }
  const remove = async () => {
    if (!window.studio?.deleteStyleTemplate || !selected) return
    const selectedTemplate = selected
    setBusy(true)
    setError(null)
    setStatus(null)
    try {
      await window.studio.deleteStyleTemplate(selectedTemplate.id)
      const remaining = (templates ?? []).filter(({ id: value }) => value !== selectedTemplate.id)
      setTemplates(remaining)
      setSelectedId(remaining[0]?.id ?? null)
      setConfirmingDelete(false)
      setStatus(`Deleted “${selectedTemplate.name}”.`)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  const load = async () => {
    if (!selected || busy) return
    const selectedTemplate = selected
    const linkedBackground = selectedTemplate.preferences.stageStyle.background
    setBusy(true)
    setError(null)
    setStatus(null)
    try {
      const background = onPrepareTemplateBackground
        ? await onPrepareTemplateBackground(
            linkedBackground.mode === 'image' ? selectedTemplate.id : null,
          )
        : null
      if (background?.status === 'stale') {
        setError(
          'This saved template is no longer available. Reload the template library and try again.',
        )
        return
      }
      onDraftChange((current) => {
        const loaded = loadStyleTemplateIntoDraft(current, selectedTemplate)
        if (!background || background.status === 'cleared' || linkedBackground.mode !== 'image')
          return loaded
        return {
          ...loaded,
          stageStyle: {
            ...loaded.stageStyle,
            background: {
              ...loaded.stageStyle.background,
              imagePath: background.path,
              mode: 'image',
            },
          },
        }
      })
      setStatus(`Loaded “${selectedTemplate.name}” into this Style draft.`)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section
      id={id}
      role="tabpanel"
      aria-labelledby={labelledBy}
      hidden={!active}
      className="style-templates"
    >
      <p className="style-field-help">
        Templates change this Style draft only. Apply &amp; close makes the project edit.
      </p>
      <label className="style-field">
        <span>Search templates</span>
        <input
          aria-label="Search saved templates"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
      </label>
      <div className="style-template-list" aria-label="Saved style templates" aria-busy={busy}>
        {templates === null || (busy && templates.length === 0) ? (
          <p>Loading templates…</p>
        ) : loadFailed ? (
          <p>Saved templates could not be loaded.</p>
        ) : visible.length ? (
          visible.map((template) => (
            <button
              key={template.id}
              type="button"
              aria-pressed={template.id === selectedId}
              disabled={busy}
              onClick={() => {
                setSelectedId(template.id)
                setConfirmingDelete(false)
                setStatus(null)
              }}
            >
              {template.name}
            </button>
          ))
        ) : (
          <p>{templates.length ? 'No templates match your search.' : 'No saved templates yet.'}</p>
        )}
      </div>
      {selected && (
        <section className="style-template-detail" aria-label="Selected template">
          <h3>{selected.name}</h3>
          <p>Includes stage, lyric display, Lead Vocal, and export defaults.</p>
          {selected.preferences.stageStyle.background.mode === 'image' && (
            <p>
              Includes a linked background image. Its availability is checked in Preview after
              loading; a missing image remains linked for relinking.
            </p>
          )}
          <p>
            If a local font is unavailable, it remains selected and uses the Preview and MP4
            fallback.
          </p>
          <Button variant="primary" disabled={busy} onClick={() => void load()}>
            Load into Style
          </Button>
        </section>
      )}
      <section className="style-template-actions" aria-label="Template management">
        <label className="style-field">
          <span>Save draft as new</span>
          <input
            aria-label="New template name"
            value={newName}
            onChange={(event) => setNewName(event.currentTarget.value)}
          />
        </label>
        <div>
          <Button
            variant="secondary"
            disabled={busy || !newName.trim()}
            onClick={() => void create()}
          >
            Save as new
          </Button>
        </div>
        {selected && (
          <>
            <label className="style-field">
              <span>Rename selected template</span>
              <input
                aria-label="Rename selected template"
                value={renameName}
                onChange={(event) => setRenameName(event.currentTarget.value)}
              />
            </label>
            <div>
              <Button
                variant="ghost"
                disabled={busy || !renameName.trim() || renameName.trim() === selected.name}
                onClick={() => void rename()}
              >
                Rename
              </Button>
              {!confirmingDelete && (
                <Button
                  id={deleteButtonId}
                  variant="danger"
                  disabled={busy}
                  onClick={() => setConfirmingDelete(true)}
                >
                  Delete
                </Button>
              )}
            </div>
          </>
        )}
      </section>
      {selected && confirmingDelete && (
        <div className="style-template-confirm-backdrop" role="presentation">
          <div
            className="style-template-confirm"
            role="alertdialog"
            aria-modal="true"
            aria-label="Confirm template deletion"
            tabIndex={-1}
            onKeyDown={(event) => {
              event.stopPropagation()
              if (event.key === 'Escape') {
                event.preventDefault()
                if (!busy) closeDeleteConfirmation()
                return
              }
              if (event.key !== 'Tab') return
              const actions = [
                ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
                  'button:not([disabled])',
                ),
              ]
              event.preventDefault()
              if (!actions.length) {
                event.currentTarget.focus()
                return
              }
              const first = actions[0]!
              const last = actions.at(-1) ?? first
              ;(event.shiftKey
                ? document.activeElement === first
                  ? last
                  : first
                : document.activeElement === last
                  ? first
                  : last
              ).focus()
            }}
          >
            <p>Delete “{selected.name}”?</p>
            <div className="style-template-confirm__actions">
              <Button autoFocus variant="ghost" disabled={busy} onClick={closeDeleteConfirmation}>
                Keep
              </Button>
              <Button variant="danger" disabled={busy} onClick={() => void remove()}>
                Delete template
              </Button>
            </div>
          </div>
        </div>
      )}
      {loadFailed && window.studio?.listStyleTemplates && (
        <Button variant="secondary" disabled={busy} onClick={() => void reload()}>
          Retry loading templates
        </Button>
      )}
      {status && (
        <p role="status" className="style-template-status">
          {status}
        </p>
      )}
      {error && (
        <p role="alert" className="style-template-error">
          {error}
        </p>
      )}
    </section>
  )
}
