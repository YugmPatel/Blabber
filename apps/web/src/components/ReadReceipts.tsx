import type { Message } from '@repo/types';

interface ReadReceiptsProps {
  status: Message['status'];
  isSentByMe: boolean;
}

export default function ReadReceipts({ status, isSentByMe }: ReadReceiptsProps) {
  if (!isSentByMe) {
    return null;
  }

  return (
    <div className="flex items-center gap-0.5 ml-1">
      {status === 'sent' && (
        <svg
          className="w-4 h-4 text-gray-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-label="Sent"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      )}
      {status === 'delivered' && (
        <div className="relative">
          <svg
            className="w-4 h-4 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-label="Delivered"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          <svg
            className="w-4 h-4 text-gray-400 absolute -right-1.5 top-0"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
      )}
      {status === 'failed' && (
        <svg
          className="w-4 h-4 text-rose-500"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-label="Failed to send"
        >
          <circle cx="12" cy="12" r="9" strokeWidth={2} />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01" />
        </svg>
      )}
      {status === 'read' && (
        <div className="relative">
          <svg
            className="w-4 h-4 text-blue-500"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-label="Read"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          <svg
            className="w-4 h-4 text-blue-500 absolute -right-1.5 top-0"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
      )}
    </div>
  );
}
