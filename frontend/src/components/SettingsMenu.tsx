import { ActionIcon, Menu, Tooltip } from '@mantine/core';
import { IconAdjustments, IconBuilding, IconSettings } from '@tabler/icons-react';
import { Link, useLocation } from 'react-router-dom';

/** Gear button in the header with a menu of setup pages. */
export function SettingsMenu() {
  const path = useLocation().pathname;
  const onSetupPage = path.startsWith('/companies') || path.startsWith('/preferences');
  return (
    <Menu position="bottom-end" width={200} shadow="md">
      <Menu.Target>
        <Tooltip label="Settings">
          <ActionIcon variant={onSetupPage ? 'light' : 'default'} size="lg" aria-label="Settings">
            <IconSettings size={18} />
          </ActionIcon>
        </Tooltip>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Item component={Link} to="/companies" leftSection={<IconBuilding size={16} />}>
          Companies
        </Menu.Item>
        <Menu.Item component={Link} to="/preferences" leftSection={<IconAdjustments size={16} />}>
          Preferences
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}
