import { Alert, Button, Card, Group, Loader, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import { IconPlus } from '@tabler/icons-react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { CompanyLogo } from '../components/CompanyLogo';
import { useAsync } from '../useAsync';

export default function CompaniesPage() {
  const { data: companies, error, loading } = useAsync(api.companies.list);

  return (
    <Stack gap="lg">
      <Group justify="space-between">
        <Title order={2}>Companies</Title>
        <Button component={Link} to="/companies/new" leftSection={<IconPlus size={16} />}>Add company</Button>
      </Group>
      {loading && <Loader />}
      {error && <Alert color="red">{error}</Alert>}
      {companies?.length === 0 && <Text c="dimmed">No companies yet. Add one to start building its interview panel.</Text>}
      <SimpleGrid cols={{ base: 2, sm: 3, md: 4, lg: 6 }} spacing="lg">
        {companies?.map((c) => (
          <Card key={c.id} component={Link} to={`/companies/${c.id}`} className="hover-card">
            <Stack align="center" gap="xs">
              <CompanyLogo company={c} size={72} />
              <Text fw={600} ta="center">{c.name}</Text>
              <Text size="sm" c="dimmed">
                {c.interviewerCount} interviewer{c.interviewerCount === 1 ? '' : 's'}
              </Text>
            </Stack>
          </Card>
        ))}
      </SimpleGrid>
    </Stack>
  );
}
