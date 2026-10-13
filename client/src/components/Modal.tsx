import * as Dialog from '@radix-ui/react-dialog';
import type { ReactNode } from 'react';
import { t } from '../i18n/index.ts';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  className?: string;
}

/** Fenêtre modale (Radix Dialog) : Échap ou clic à l'extérieur pour fermer. */
export function Modal({ open, onClose, title, children, className = '' }: ModalProps) {
  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-overlay" />
        <Dialog.Content className={`modal panel ${className}`} aria-describedby={undefined}>
          <header className="modal-header">
            <Dialog.Title asChild>
              <h2>{title}</h2>
            </Dialog.Title>
            <Dialog.Close className="modal-close" aria-label={t('common.close')}>
              ×
            </Dialog.Close>
          </header>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
