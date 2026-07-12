import { useEffect, useId, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { X } from 'lucide-react'

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: 'sm' | 'md'
}

export function Button({ variant = 'secondary', size = 'md', className = '', ...props }: ButtonProps) {
  return <button className={`button button--${variant} button--${size} ${className}`} {...props} />
}

export function IconButton({ className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={`icon-button ${className}`} {...props} />
}

export function LogoMark({ small = false }: { small?: boolean }) {
  return (
    <span className={`logo-mark ${small ? 'logo-mark--small' : ''}`} aria-hidden="true">
      <span className="logo-mark__ring" />
      <span className="logo-mark__stem" />
      <span className="logo-mark__spark" />
    </span>
  )
}

interface ModalProps {
  title: string
  eyebrow?: string
  children: ReactNode
  footer?: ReactNode
  onClose: () => void
  wide?: boolean
  closeDisabled?: boolean
}

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

export function Modal({
  title,
  eyebrow,
  children,
  footer,
  onClose,
  wide = false,
  closeDisabled = false,
}: ModalProps) {
  const backdropRef = useRef<HTMLDivElement>(null)
  const dialogRef = useRef<HTMLElement>(null)
  const onCloseRef = useRef(onClose)
  const titleId = useId()

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    const backdrop = backdropRef.current
    const dialog = dialogRef.current
    if (!backdrop || !dialog) return
    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    const siblings = backdrop.parentElement
      ? [...backdrop.parentElement.children].filter(
          (element): element is HTMLElement => element instanceof HTMLElement && element !== backdrop,
        )
      : []
    const priorInert = siblings.map((element) => element.inert)
    siblings.forEach((element) => { element.inert = true })

    const focusable = () => [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)]
      .filter((element) => !element.hidden)
    const focusFrame = window.requestAnimationFrame(() => {
      if (document.activeElement instanceof HTMLElement && dialog.contains(document.activeElement)) return
      const autofocus = dialog.querySelector<HTMLElement>('[autofocus]')
      ;(autofocus ?? focusable()[0] ?? dialog).focus()
    })
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !closeDisabled) {
        event.preventDefault()
        event.stopPropagation()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const candidates = focusable()
      if (candidates.length === 0) {
        event.preventDefault()
        dialog.focus()
        return
      }
      const first = candidates[0]
      const last = candidates.at(-1) ?? first
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown, true)

    return () => {
      window.cancelAnimationFrame(focusFrame)
      document.removeEventListener('keydown', handleKeyDown, true)
      siblings.forEach((element, index) => { element.inert = priorInert[index] })
      previousFocus?.focus()
    }
  }, [closeDisabled])

  return (
    <div
      ref={backdropRef}
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (!closeDisabled && event.target === event.currentTarget) onClose()
      }}
    >
      <section
        ref={dialogRef}
        className={`modal ${wide ? 'modal--wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <header className="modal__header">
          <div>
            {eyebrow && <span className="eyebrow">{eyebrow}</span>}
            <h2 id={titleId}>{title}</h2>
          </div>
          <IconButton aria-label="Close dialog" onClick={onClose} disabled={closeDisabled}>
            <X size={18} />
          </IconButton>
        </header>
        <div className="modal__body">{children}</div>
        {footer && <footer className="modal__footer">{footer}</footer>}
      </section>
    </div>
  )
}

export function KeyboardKey({ children }: { children: ReactNode }) {
  return <kbd className="keyboard-key">{children}</kbd>
}

export function Meter({ value, label }: { value: number; label: string }) {
  return (
    <div className="meter" title={label}>
      <span className="meter__fill" style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
    </div>
  )
}
