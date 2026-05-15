import type { ChatIntelligenceSummary } from '@repo/types';

interface ChatSummaryPanelProps {
  summary: ChatIntelligenceSummary;
}

function EmptySection({ text }: { text: string }) {
  return <p className="text-sm text-gray-500">{text}</p>;
}

export default function ChatSummaryPanel({ summary }: ChatSummaryPanelProps) {
  return (
    <div className="mt-3 space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-gray-900">Summary</h3>
        <p className="mt-1 text-sm text-gray-700">{summary.summary}</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <section>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-600">Decisions</h4>
          <div className="mt-1 space-y-1">
            {summary.decisions.length === 0 && <EmptySection text="No decisions captured." />}
            {summary.decisions.map((decision, index) => (
              <div key={`${decision.title}-${index}`} className="text-sm text-gray-700">
                <p className="font-medium">{decision.title}</p>
                <p className="text-xs text-gray-500">Status: {decision.status}</p>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-600">Tasks</h4>
          <div className="mt-1 space-y-1">
            {summary.tasks.length === 0 && <EmptySection text="No tasks captured." />}
            {summary.tasks.map((task, index) => (
              <div key={`${task.title}-${index}`} className="text-sm text-gray-700">
                <p className="font-medium">{task.title}</p>
                <p className="text-xs text-gray-500">
                  {task.assignedTo ? `Assigned to ${task.assignedTo}` : 'Unassigned'}
                  {task.dueDate ? ` • Due ${task.dueDate}` : ''}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-600">
            Questions For Me
          </h4>
          <div className="mt-1 space-y-1">
            {summary.questionsForMe.length === 0 && <EmptySection text="No direct questions." />}
            {summary.questionsForMe.map((question, index) => (
              <p key={`${question.question}-${index}`} className="text-sm text-gray-700">
                {question.question}
              </p>
            ))}
          </div>
        </section>

        <section>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-600">Important Links</h4>
          <div className="mt-1 space-y-1">
            {summary.importantLinks.length === 0 && <EmptySection text="No links highlighted." />}
            {summary.importantLinks.map((link, index) => (
              <a
                key={`${link.url}-${index}`}
                href={link.url}
                target="_blank"
                rel="noreferrer"
                className="block text-sm text-blue-600 hover:underline"
              >
                {link.label || link.url}
              </a>
            ))}
          </div>
        </section>

        <section>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-600">Waiting On</h4>
          <div className="mt-1 space-y-1">
            {summary.waitingOn.length === 0 && <EmptySection text="Nothing currently waiting." />}
            {summary.waitingOn.map((item, index) => (
              <p key={`${item.title}-${index}`} className="text-sm text-gray-700">
                {item.title}
              </p>
            ))}
          </div>
        </section>

        <section>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-600">Noise</h4>
          <div className="mt-1 space-y-1">
            {summary.noise.length === 0 && <EmptySection text="No side chat noted." />}
            {summary.noise.map((item, index) => (
              <p key={`${item.text}-${index}`} className="text-sm text-gray-700">
                {item.text}
              </p>
            ))}
          </div>
        </section>
      </div>

      {summary.generatedAt && (
        <p className="text-xs text-gray-400">
          Generated {new Date(summary.generatedAt).toLocaleString()}
        </p>
      )}
    </div>
  );
}