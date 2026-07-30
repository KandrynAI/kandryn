import type { Metadata } from 'next';
import PageHeader from '@/components/layout/PageHeader';
import FaqAccordion from '@/components/FaqAccordion';
import { JsonLd, faqPageLd } from '@/lib/jsonld';

export const metadata: Metadata = {
  title: 'FAQ',
  description: 'The questions engineers ask first about Blue Mantis — merging, keys, scope, failures and providers.',
};

export default function FaqPage() {
  return (
    <>
      <PageHeader title={<>The questions<br />engineers ask first.</>} />
      <FaqAccordion />
      <JsonLd data={faqPageLd} />
    </>
  );
}
