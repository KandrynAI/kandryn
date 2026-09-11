import type { Metadata } from 'next';
import PageHeader from '@/components/layout/PageHeader';
import ResourcesView from '@/components/ResourcesView';

export const metadata: Metadata = {
  title: 'Getting started',
  description: 'The setup sequence, step by step, and a dated record of what has shipped.',
};

export default function ResourcesPage() {
  return (
    <>
      <PageHeader
        title={<>Set it up once.<br />Then read the diffs.</>}
        lead="What connecting Kandryn actually involves, in the order you will do it — and a dated record of what has shipped."
      />
      <ResourcesView />
    </>
  );
}
