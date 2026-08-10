import type { Metadata } from 'next';
import PageHeader from '@/components/layout/PageHeader';
import ResourcesView from '@/components/ResourcesView';

export const metadata: Metadata = {
  title: 'Resources',
  description: 'Guides, patterns, engineering notes and templates for running agents against a real backlog.',
};

export default function ResourcesPage() {
  return (
    <>
      <PageHeader
        title={<>Everything we know<br />about running agents<br />against a real backlog.</>}
        lead="Guides for the setup, patterns from real pilots, and the engineering behind the run — plus the templates we hand every new team."
      />
      <ResourcesView />
    </>
  );
}
