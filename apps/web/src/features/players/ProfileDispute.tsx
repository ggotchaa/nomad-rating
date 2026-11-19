import { useState } from 'react'
import { api } from '../../api/client.ts'
import { t } from '../../i18n/index.ts'
import { Field, Modal } from '../../ui/kit.tsx'
import { useAction } from '../account/AccountFlows.tsx'

/** T-19: «this card is mine» — a dispute with documents for the platform admin. */
export function ProfileDisputeButton({ playerId }: { playerId: number }) {
  const [open, setOpen] = useState(false)
  const [sent, setSent] = useState(false)
  const [files, setFiles] = useState<File[]>([])
  const [reason, setReason] = useState('')
  const { busy, run, notes } = useAction()
  if (sent) return <span className="chip chip--ok">{t.cards.disputeSent}</span>
  const submit = () =>
    void run(async () => {
      const documents = []
      for (const f of files) {
        const r = await api<{ url: string }>('/my/profile-disputes/documents', { method: 'POST', body: f, headers: { 'Content-Type': f.type } })
        documents.push({ name: f.name.slice(0, 200), url: r.url })
      }
      await api('/my/profile-disputes', { method: 'POST', json: { playerId, reason, documents } })
      setOpen(false)
      setSent(true)
    })
  return (
    <>
      <button className="button button--sm" onClick={() => setOpen(true)}>
        {t.cards.disputeCta}
      </button>
      {open && (
        <Modal title={t.cards.disputeTitle} onClose={() => setOpen(false)}>
          <form
            className="form stack"
            onSubmit={(e) => {
              e.preventDefault()
              submit()
            }}
          >
            <p className="small muted">{t.cards.disputeLead}</p>
            <Field label={t.cards.disputeReason}>
              <textarea rows={4} minLength={5} maxLength={2000} required value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
            <Field label={t.cards.disputeDocs}>
              <input type="file" multiple required accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(e) => setFiles([...(e.target.files ?? [])].slice(0, 10))} />
            </Field>
            {notes}
            <button className="button button--primary" disabled={busy || !files.length}>
              {t.cards.disputeSend}
            </button>
          </form>
        </Modal>
      )}
    </>
  )
}
