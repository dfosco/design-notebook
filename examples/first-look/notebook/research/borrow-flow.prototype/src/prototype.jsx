import { useState } from 'react'
import { useFlowData } from '@dfosco/statefully/react'

export default function App() {
  const content = useFlowData('request')
  const [requested, setRequested] = useState(false)

  return (
    <main className="screen">
      <header className="topbar">
        <span className="mark" aria-hidden="true">B</span>
        <span>Borrow Desk</span>
        <span className="topbar-note">Member preview</span>
      </header>
      <section className="card" aria-labelledby="book-title">
        <p className="eyebrow">{content.section}</p>
        <h1 id="book-title">{content.title}</h1>
        <p className="summary">{content.summary}</p>
        <div className="availability">
          <span className="availability-dot" aria-hidden="true" />
          <span>{content.availability}</span>
        </div>
        <button type="button" onClick={() => setRequested(true)}>
          {requested ? content.confirmation : content.action}
        </button>
        <p className="fine-print">{content.finePrint}</p>
      </section>
    </main>
  )
}
