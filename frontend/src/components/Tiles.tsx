import { avatarFor } from '../avatar';
import type { InterviewerRef } from '../types';
import { IconMicrophone, IconMicrophoneOff } from '@tabler/icons-react';

export type TileState = 'idle' | 'speaking' | 'asking' | 'thinking';

export function InterviewerTile({ interviewer, state, size = 'normal' }: {
  interviewer: InterviewerRef;
  state: TileState;
  size?: 'normal' | 'hero';
}) {
  return (
    <div className={`tile interviewer-tile ${size} ${state}`}>
      <div className="tile-media">
        <img className="tile-photo" src={avatarFor(interviewer)} alt="" />
        {state === 'speaking' && <span className="eq" aria-label="Speaking"><i /><i /><i /><i /></span>}
        {state === 'thinking' && <span className="dots"><i /><i /><i /></span>}
      </div>
      <div className="nameplate">
        <strong>{interviewer.name}</strong>
        {interviewer.title && <span>{interviewer.title}</span>}
      </div>
      {state === 'asking' && <span className="tile-badge">Waiting for your answer</span>}
    </div>
  );
}

export function CandidateTile({ name, stream, cameraError, listening, pip }: {
  name: string;
  stream: MediaStream | null;
  cameraError: string | null;
  listening: boolean;
  pip?: boolean;
}) {
  return (
    <div className={`tile candidate-tile ${pip ? 'pip' : ''} ${listening ? 'listening' : ''}`}>
      <div className="tile-media">
        {stream ? (
          <video
            className="tile-video"
            autoPlay
            muted
            playsInline
            ref={(el) => {
              if (el && el.srcObject !== stream) el.srcObject = stream;
            }}
          />
        ) : (
          <div className="tile-initials">
            {name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('')}
            {cameraError && !pip && <small>{cameraError}</small>}
          </div>
        )}
      </div>
      <div className="nameplate">
        <strong>{name} (you)</strong>
        <span className={`mic-state ${listening ? 'on' : ''}`}>
          {listening ? <IconMicrophone size={14} /> : <IconMicrophoneOff size={14} />}
        </span>
      </div>
    </div>
  );
}
