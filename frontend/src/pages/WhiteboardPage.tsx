import { ActionIcon, Center, Loader, Tooltip } from '@mantine/core';
import { IconX } from '@tabler/icons-react';
import { lazy, Suspense, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { loadScratch, saveScratch } from '../whiteboard';

// Excalidraw is a large bundle: only load it when this page opens.
const Whiteboard = lazy(() => import('../components/Whiteboard'));

/**
 * A full-page practice whiteboard (/whiteboard), outside any interview: the same editor and component library as
 * the interview room, with the board kept in this browser (whiteboard.ts `loadScratch` / `saveScratch`).
 */
export default function WhiteboardPage() {
  const navigate = useNavigate();
  const initial = useMemo(loadScratch, []);
  // Opened from the app, go back to where the user was; opened directly (new tab, bookmark), go home.
  const back = () => (window.history.state?.idx > 0 ? navigate(-1) : navigate('/'));

  return (
    <div className="whiteboard-page">
      <Suspense fallback={<Center h="100%"><Loader /></Center>}>
        <Whiteboard
          initial={initial}
          onChange={saveScratch}
          topRight={
            <Tooltip label="Close whiteboard" position="left">
              <ActionIcon className="whiteboard-close" variant="default" size={36} onClick={back}
                aria-label="Close whiteboard">
                <IconX size={18} />
              </ActionIcon>
            </Tooltip>
          }
        />
      </Suspense>
    </div>
  );
}
