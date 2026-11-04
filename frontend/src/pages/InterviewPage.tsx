import { Alert, Center, Loader } from '@mantine/core';
import { useParams } from 'react-router-dom';
import { api } from '../api';
import { useAsync } from '../useAsync';
import InterviewReport from './InterviewReport';
import InterviewRoom from './InterviewRoom';

/** Live interview room while IN_PROGRESS, report once the interview has ended. */
export default function InterviewPage() {
  const id = Number(useParams().id);
  const { data: interview, error, loading, setData } = useAsync(() => api.interviews.get(id), [id]);

  if (loading && !interview) return <Center py="xl"><Loader /></Center>;
  if (error) return <Alert color="red">{error}</Alert>;
  if (!interview) return null;

  return interview.status === 'IN_PROGRESS'
    ? <InterviewRoom interview={interview} onUpdate={setData} />
    : <InterviewReport interview={interview} />;
}
