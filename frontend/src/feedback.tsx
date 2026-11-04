import { Text } from '@mantine/core';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';

/** Shows a failed action's message (the backend's ProblemDetail `detail`) as a red toast. */
export const notifyError = (err: unknown, title = 'Something went wrong') =>
  notifications.show({ color: 'red', title, message: (err as Error).message, autoClose: 8000 });

/** A Mantine confirm dialog in place of window.confirm; resolves true when confirmed. */
export const confirmAction = ({ title, message, confirmLabel, danger = false }: {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
}) =>
  new Promise<boolean>((resolve) => {
    modals.openConfirmModal({
      title,
      centered: true,
      children: <Text size="sm">{message}</Text>,
      labels: { confirm: confirmLabel, cancel: 'Cancel' },
      confirmProps: danger ? { color: 'red' } : undefined,
      onConfirm: () => resolve(true),
      onCancel: () => resolve(false),
      onClose: () => resolve(false),
    });
  });
