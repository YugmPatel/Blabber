import { useState, useRef, useEffect } from 'react';
import { X, Send, Sparkles, Copy, ThumbsUp, ThumbsDown, RefreshCw, Loader2 } from 'lucide-react';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

interface MetaAIChatProps {
  isOpen: boolean;
  onClose: () => void;
  onInsertToChat?: (text: string) => void;
}

// Simulated AI responses for demo
const AI_RESPONSES: Record<string, string> = {
  default:
    "I'm Meta AI, your helpful assistant! I can help you with questions, creative writing, coding, and more. What would you like to know?",
  greeting: "Hello! 👋 I'm Meta AI. How can I help you today?",
  weather:
    "I don't have access to real-time weather data, but I can help you find weather information! Try checking weather.com or your phone's weather app for accurate forecasts.",
  joke: "Why don't scientists trust atoms? Because they make up everything! 😄",
  help: 'I can help you with:\n• Answering questions\n• Writing and editing text\n• Explaining concepts\n• Creative brainstorming\n• Coding assistance\n• And much more!\n\nJust ask me anything!',
};

export default function MetaAIChat({ isOpen, onClose, onInsertToChat }: MetaAIChatProps) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      role: 'assistant',
      content: AI_RESPONSES.default,
      timestamp: new Date(),
    },
  ]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      inputRef.current?.focus();
    }
  }, [isOpen]);

  // Generate AI response (simulated)
  const generateResponse = (userMessage: string): string => {
    const lowerMessage = userMessage.toLowerCase();

    if (
      lowerMessage.includes('hello') ||
      lowerMessage.includes('hi') ||
      lowerMessage.includes('hey')
    ) {
      return AI_RESPONSES.greeting;
    }
    if (lowerMessage.includes('weather')) {
      return AI_RESPONSES.weather;
    }
    if (lowerMessage.includes('joke') || lowerMessage.includes('funny')) {
      return AI_RESPONSES.joke;
    }
    if (lowerMessage.includes('help') || lowerMessage.includes('what can you do')) {
      return AI_RESPONSES.help;
    }
    if (lowerMessage.includes('code') || lowerMessage.includes('programming')) {
      return "I can help with coding! Share your code or describe what you're trying to build, and I'll do my best to assist. I support many languages including JavaScript, Python, TypeScript, and more.";
    }
    if (lowerMessage.includes('thank')) {
      return "You're welcome! 😊 Is there anything else I can help you with?";
    }

    // Default contextual response
    return `That's an interesting question about "${userMessage.slice(0, 50)}${userMessage.length > 50 ? '...' : ''}". In a production environment, I would connect to Meta's AI backend to provide a detailed, accurate response. For now, I'm running in demo mode. Is there something specific I can help you explore?`;
  };

  const handleSend = async () => {
    const trimmedInput = input.trim();
    if (!trimmedInput || isTyping) return;

    // Add user message
    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: trimmedInput,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsTyping(true);

    // Simulate AI thinking delay
    await new Promise((resolve) => setTimeout(resolve, 1000 + Math.random() * 1000));

    // Generate and add AI response
    const aiResponse: Message = {
      id: (Date.now() + 1).toString(),
      role: 'assistant',
      content: generateResponse(trimmedInput),
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, aiResponse]);
    setIsTyping(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const regenerateResponse = async (messageId: string) => {
    const messageIndex = messages.findIndex((m) => m.id === messageId);
    if (messageIndex === -1 || messages[messageIndex].role !== 'assistant') return;

    // Find the user message before this response
    const userMessage = messages
      .slice(0, messageIndex)
      .reverse()
      .find((m) => m.role === 'user');
    if (!userMessage) return;

    setIsTyping(true);
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const newResponse = generateResponse(userMessage.content + ' (regenerated)');
    setMessages((prev) =>
      prev.map((m) =>
        m.id === messageId ? { ...m, content: newResponse, timestamp: new Date() } : m
      )
    );
    setIsTyping(false);
  };

  const clearChat = () => {
    setMessages([
      {
        id: Date.now().toString(),
        role: 'assistant',
        content: AI_RESPONSES.default,
        timestamp: new Date(),
      },
    ]);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="flex h-[600px] w-full max-w-lg flex-col rounded-lg bg-white shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 bg-gradient-to-r from-blue-600 to-purple-600 p-4 rounded-t-lg">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white">
              <Sparkles className="h-6 w-6 text-blue-600" />
            </div>
            <div>
              <h2 className="font-semibold text-white">Meta AI</h2>
              <p className="text-xs text-white/80">Powered by AI</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={clearChat}
              className="rounded-full p-2 text-white/80 hover:bg-white/10 hover:text-white"
              title="Clear chat"
            >
              <RefreshCw size={18} />
            </button>
            <button
              onClick={onClose}
              className="rounded-full p-2 text-white/80 hover:bg-white/10 hover:text-white"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.map((message) => (
            <div
              key={message.id}
              className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[80%] rounded-lg p-3 ${
                  message.role === 'user' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-900'
                }`}
              >
                {message.role === 'assistant' && (
                  <div className="mb-1 flex items-center gap-1">
                    <Sparkles size={14} className="text-blue-600" />
                    <span className="text-xs font-medium text-blue-600">Meta AI</span>
                  </div>
                )}
                <p className="whitespace-pre-wrap text-sm">{message.content}</p>
                <p
                  className={`mt-1 text-xs ${message.role === 'user' ? 'text-white/70' : 'text-gray-500'}`}
                >
                  {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </p>

                {/* AI message actions */}
                {message.role === 'assistant' && (
                  <div className="mt-2 flex items-center gap-2 border-t border-gray-200 pt-2">
                    <button
                      onClick={() => copyToClipboard(message.content)}
                      className="rounded p-1 text-gray-500 hover:bg-gray-200 hover:text-gray-700"
                      title="Copy"
                    >
                      <Copy size={14} />
                    </button>
                    {onInsertToChat && (
                      <button
                        onClick={() => onInsertToChat(message.content)}
                        className="rounded px-2 py-1 text-xs text-blue-600 hover:bg-blue-50"
                      >
                        Insert to chat
                      </button>
                    )}
                    <button
                      onClick={() => regenerateResponse(message.id)}
                      className="rounded p-1 text-gray-500 hover:bg-gray-200 hover:text-gray-700"
                      title="Regenerate"
                    >
                      <RefreshCw size={14} />
                    </button>
                    <div className="ml-auto flex items-center gap-1">
                      <button className="rounded p-1 text-gray-500 hover:bg-gray-200 hover:text-green-600">
                        <ThumbsUp size={14} />
                      </button>
                      <button className="rounded p-1 text-gray-500 hover:bg-gray-200 hover:text-red-600">
                        <ThumbsDown size={14} />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}

          {/* Typing indicator */}
          {isTyping && (
            <div className="flex justify-start">
              <div className="flex items-center gap-2 rounded-lg bg-gray-100 px-4 py-3">
                <Loader2 size={16} className="animate-spin text-blue-600" />
                <span className="text-sm text-gray-600">Meta AI is thinking...</span>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Suggestions */}
        {messages.length === 1 && (
          <div className="border-t border-gray-200 p-4">
            <p className="mb-2 text-xs font-medium text-gray-500">Try asking:</p>
            <div className="flex flex-wrap gap-2">
              {['Tell me a joke', 'What can you help with?', 'Help me write a message'].map(
                (suggestion) => (
                  <button
                    key={suggestion}
                    onClick={() => setInput(suggestion)}
                    className="rounded-full border border-gray-300 px-3 py-1 text-sm text-gray-700 hover:bg-gray-50"
                  >
                    {suggestion}
                  </button>
                )
              )}
            </div>
          </div>
        )}

        {/* Input */}
        <div className="border-t border-gray-200 p-4">
          <div className="flex items-center gap-2">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask Meta AI anything..."
              className="flex-1 rounded-full border border-gray-300 px-4 py-2 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              disabled={isTyping}
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || isTyping}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-600 text-white hover:bg-blue-700 disabled:bg-gray-300"
            >
              <Send size={18} />
            </button>
          </div>
          <p className="mt-2 text-center text-xs text-gray-500">
            Meta AI may produce inaccurate information. Verify important facts.
          </p>
        </div>
      </div>
    </div>
  );
}
