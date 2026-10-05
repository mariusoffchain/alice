'use client';

import { useChat } from '@alice-wallet/alice-ai';
import { AliceRabbit } from '@/components/AliceRabbit';
import { ChatMessage } from '@/components/ChatMessage';
import { useAutoScroll } from '@/hooks/use-auto-scroll';
import { useChatRabbit } from '@/hooks/use-chat-rabbit';

/** The main chat's single, fixed mascot and bottom-aligned history in a dock. */
export function SideChatConversation({ input, questions, onQuestion, disabled = false, lang = 'en' }: {
  input: string;
  questions: readonly string[];
  onQuestion: (question: string) => void;
  disabled?: boolean;
  lang?: 'en' | 'fr';
}) {
  const { messages, busy, aiEnabled, backendStatus, lastRequestFailed } = useChat();
  const scrollRef = useAutoScroll([messages, busy]);
  const latestUserIndex = messages.reduce((latest, message, index) => message.role === 'user' ? index : latest, -1);
  const replyStarted = latestUserIndex >= 0 && messages.slice(latestUserIndex + 1)
    .some(message => message.role === 'assistant' && message.content.trim().length > 0);
  const available = aiEnabled && backendStatus.state === 'ready' && !lastRequestFailed;
  const rabbitState = useChatRabbit({ input, busy, available, replyStarted });
  const visible = messages.filter(message => !(busy && message.role === 'assistant' && !message.content));
  const streamingId = busy && replyStarted
    ? [...visible].reverse().find(message => message.role === 'assistant')?.id : undefined;

  return <>
    <div className="atelier-stage alice-side-stage">
      <div className="atelier-perch"><AliceRabbit state={rabbitState} connected={available} size={32} /></div>
      <div ref={scrollRef} className="atelier-history" role="region" aria-label={lang === 'fr' ? 'Conversation avec Alice' : 'Conversation with Alice'} tabIndex={0}>
        <div className="atelier-messages">
          {visible.map(message => <ChatMessage key={message.id} message={message} compact showAvatar={false} streaming={message.id === streamingId} />)}
          {messages.length === 0 && <p className="font-numbers m-0" style={{ color: 'var(--alice-text)' }}>
            {lang === 'fr' ? 'Salut ! Que souhaites-tu apprendre aujourd’hui ?' : 'Hi! What would you like to learn about today?'}
          </p>}
          {busy && !replyStarted && <p className="atelier-waiting" role="status">{lang === 'fr' ? 'Préparation d’une réponse…' : 'Preparing a response…'}</p>}
        </div>
      </div>
    </div>
    {messages.length === 0 && <div className="alice-side-suggestions">
      {questions.map(question => <button key={question} type="button" onClick={() => onQuestion(question)} disabled={busy || !aiEnabled || disabled} className="alice-control alice-panel-suggestion" title={`Send: ${question}`}>
        <span>{question}</span>
      </button>)}
    </div>}
    {aiEnabled && (lastRequestFailed || backendStatus.state !== 'ready') && <p className="alice-side-model-status" role="status">
      {lastRequestFailed ? (lang === 'fr' ? 'La dernière requête a échoué' : 'Last request failed') : backendStatus.state === 'loading' ? (lang === 'fr' ? 'Chargement du modèle…' : 'Loading model…') : (lang === 'fr' ? 'Modèle indisponible' : 'Model unavailable')}
    </p>}
  </>;
}
