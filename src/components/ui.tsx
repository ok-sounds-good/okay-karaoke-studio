import type { ButtonHTMLAttributes, ReactNode } from 'react'
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
}

export function Modal({ title, eyebrow, children, footer, onClose, wide = false }: ModalProps) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className={`modal ${wide ? 'modal--wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal__header">
          <div>
            {eyebrow && <span className="eyebrow">{eyebrow}</span>}
            <h2>{title}</h2>
          </div>
          <IconButton aria-label="Close dialog" onClick={onClose}>
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
