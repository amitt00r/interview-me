import { Avatar } from '@mantine/core';
import { useState } from 'react';
import type { Company } from '../types';

/** The company's logo, or its initials when it has none (or the image fails to load). */
export function CompanyLogo({ company, size = 64 }: { company: Pick<Company, 'name' | 'logoUrl'>; size?: number }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const initials = company.name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  const src = company.logoUrl && company.logoUrl !== failedUrl ? company.logoUrl : null;
  return (
    <Avatar src={src} size={size} radius="md" color="indigo" variant="light" alt={`${company.name} logo`}
      className={src ? 'company-logo' : undefined} imageProps={{ onError: () => setFailedUrl(company.logoUrl) }}>
      {initials}
    </Avatar>
  );
}
