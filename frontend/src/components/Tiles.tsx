import { avatarFor } from '../avatar';
import type { InterviewerRef } from '../types';
import { IconArrowsMaximize, IconArrowsMinimize, IconMicrophone, IconMicrophoneOff } from '@tabler/icons-react';
import type { KeyboardEvent } from 'react';

export type TileState = 'idle' | 'speaking' | 'asking' | 'thinking';

type TileSize = 'normal' | 'hero';

/** Makes a tile a button (the stage's spotlight) when it has `onClick`. */
function clickable(onClick: (() => void) | undefined, label: string) {
  if (!onClick) return {};
  return {
    onClick,
    role: 'button',
    tabIndex: 0,
    'aria-label': label,
    onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onClick();
      }
    },
  };
}

/** Hover icon on a clickable tile: enlarge, or (on the big tile) back to everyone. */
function TileAction({ size }: { size: TileSize }) {
  return (
    <span className="tile-action" aria-hidden>
      {size === 'hero' ? <IconArrowsMinimize size={16} /> : <IconArrowsMaximize size={16} />}
    </span>
  );
}

/**
 * One interviewer. Only the big (`hero`) tile shows the title; the others show just the name. `compact` is a small
 * filmstrip tile (over the whiteboard/code editor or a spotlit person): no badge or hover icon.
 */
export function InterviewerTile({ interviewer, state, size = 'normal', compact, onClick, actionLabel = 'Enlarge' }: {
  interviewer: InterviewerRef;
  state: TileState;
  size?: TileSize;
  compact?: boolean;
  onClick?: () => void;
  actionLabel?: string;
}) {
  return (
    <div className={`tile interviewer-tile ${size} ${state}${compact ? ' compact' : ''}${onClick ? ' clickable' : ''}`}
      {...clickable(onClick, `${actionLabel}: ${interviewer.name}`)}>
      <div className="tile-media">
        <img className="tile-photo" src={avatarFor(interviewer)} alt="" />
        {state === 'speaking' && <span className="eq" aria-label="Speaking"><i /><i /><i /><i /></span>}
        {state === 'thinking' && <span className="dots"><i /><i /><i /></span>}
      </div>
      <div className="nameplate">
        <strong>{interviewer.name}</strong>
        {interviewer.title && size === 'hero' && <span>{interviewer.title}</span>}
      </div>
      {state === 'asking' && !compact && <span className="tile-badge">Waiting for your answer</span>}
      {onClick && !compact && <TileAction size={size} />}
    </div>
  );
}

/** The candidate's own camera (a local preview), one tile among the interviewers'. */
export function CandidateTile({ name, stream, cameraError, listening, size = 'normal', compact, onClick,
  actionLabel = 'Enlarge' }: {
  name: string;
  stream: MediaStream | null;
  cameraError: string | null;
  listening: boolean;
  size?: TileSize;
  compact?: boolean;
  onClick?: () => void;
  actionLabel?: string;
}) {
  return (
    <div className={`tile candidate-tile ${size}${compact ? ' compact' : ''}${listening ? ' listening' : ''}${onClick ? ' clickable' : ''}`}
      {...clickable(onClick, `${actionLabel}: you`)}>
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
            {cameraError && !compact && <small>{cameraError}</small>}
          </div>
        )}
      </div>
      <div className="nameplate">
        <strong>{name} (you)</strong>
        <span className={`mic-state ${listening ? 'on' : ''}`}>
          {listening ? <IconMicrophone size={14} /> : <IconMicrophoneOff size={14} />}
        </span>
      </div>
      {onClick && !compact && <TileAction size={size} />}
    </div>
  );
}
