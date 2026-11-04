import { AppShell, Button, Container, Group, Text, Title } from '@mantine/core';
import { IconChalkboard, IconSparkles } from '@tabler/icons-react';
import { Link, Navigate, Route, Routes } from 'react-router-dom';
import { useHeaderHidden } from './chrome';
import { NikolaiWidget } from './components/NikolaiWidget';
import { SettingsMenu } from './components/SettingsMenu';
import CompaniesPage from './pages/CompaniesPage';
import CompanyPage from './pages/CompanyPage';
import InterviewPage from './pages/InterviewPage';
import PastInterviewsPage from './pages/PastInterviewsPage';
import PreferencesPage from './pages/PreferencesPage';
import WhiteboardPage from './pages/WhiteboardPage';

export default function App() {
  return (
    <Routes>
      {/* Full page: the board takes the whole window, without the app header or Nikolai. */}
      <Route path="/whiteboard" element={<WhiteboardPage />} />
      <Route path="*" element={<Shell />} />
    </Routes>
  );
}

function Shell() {
  // Collapsed while the interview room's whiteboard is open (chrome.ts).
  const headerHidden = useHeaderHidden();
  return (
    <AppShell header={{ height: 60, collapsed: headerHidden }} padding="md">
      <AppShell.Header>
        <Container size="xl" h="100%">
          <Group h="100%" justify="space-between">
            <Link to="/" className="brand">
              <Group gap={8}>
                <IconSparkles size={22} color="var(--mantine-primary-color-filled)" />
                <Title order={4}>Interview Me</Title>
              </Group>
            </Link>
            <Group gap="xs">
              <Button component={Link} to="/whiteboard" variant="default" leftSection={<IconChalkboard size={16} />}>
                Whiteboard
              </Button>
              <SettingsMenu />
            </Group>
          </Group>
        </Container>
      </AppShell.Header>
      <AppShell.Main className="app-main">
        <Container size="xl" py="md">
          <Routes>
            {/* Past interviews is the landing page; it links to starting a new one. */}
            <Route path="/" element={<PastInterviewsPage />} />
            <Route path="/interviews/new" element={<PastInterviewsPage starting />} />
            <Route path="/interviews" element={<Navigate to="/" replace />} />
            <Route path="/interviews/:id" element={<InterviewPage />} />
            <Route path="/interviewers" element={<Navigate to="/companies" replace />} />
            <Route path="/companies" element={<CompaniesPage />} />
            <Route path="/companies/:id" element={<CompanyPage />} />
            <Route path="/preferences" element={<PreferencesPage />} />
            <Route path="*" element={<Text>Page not found.</Text>} />
          </Routes>
        </Container>
      </AppShell.Main>
      <NikolaiWidget />
    </AppShell>
  );
}
