import HeroSection from '@/components/home/HeroSection';
import ProductPreview from '@/components/home/ProductPreview';
import UseCases from '@/components/home/UseCases';
import ContextSection from '@/components/home/ContextSection';
import StagesSection from '@/components/home/StagesSection';
import GovernanceCallout from '@/components/home/GovernanceCallout';
import ClosingCta from '@/components/home/ClosingCta';

/**
 * Seven sections, one idea each, in the order a visitor needs them:
 * what it is, what it produces, what it is for, what it reads before it
 * writes, how it runs, how it is governed, and the single thing to do next.
 *
 * ClosingCta is the page's own final call, so the layout's shared CtaBanner is
 * suppressed here — two competing closing offers is one too many.
 */
export default function HomePage() {
  return (
    <>
      <HeroSection />
      <ProductPreview />
      <UseCases />
      <ContextSection />
      <StagesSection />
      <GovernanceCallout />
      <ClosingCta />
    </>
  );
}
