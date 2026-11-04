import { Badge } from '@mantine/core';
import { scoreColor } from '../api';
import type { QuestionStatus } from '../types';

/** "7/10" in the score's colour for an answered question, otherwise its status. */
export function ScoreBadge({ status, score }: { status: QuestionStatus; score: number | null }) {
  if (status === 'ANSWERED' && score !== null) {
    return <Badge color={scoreColor(score, 10)} variant="light" size="lg" className="tabular">{score}/10</Badge>;
  }
  const [label, color] = {
    ANSWERED: ['Answered', 'gray'],
    SKIPPED: ['Skipped', 'orange'],
    CURRENT: ['In progress', 'indigo'],
    NOT_ATTEMPTED: ['Not attempted', 'gray'],
  }[status];
  return <Badge color={color} variant="outline" size="lg">{label}</Badge>;
}
