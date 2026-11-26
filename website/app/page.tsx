import HeroSection from '@/components/home/HeroSection';
import ProductPreview from '@/components/home/ProductPreview';
import UseCases from '@/components/home/UseCases';
import ContextSection from '@/components/home/ContextSection';
import GovernanceCallout from '@/components/home/GovernanceCallout';
import ClosingCta from '@/components/home/ClosingCta';

/**
 * Six sections, each answering the visitor's next question: what outcome is
 * on offer, how business context produces it, what that looks like on one
 * item, what kind of work it suits, who controls release, and what to do next.
 *
 * StagesSection was dropped from this page rather than reordered. It restated
 * the pipeline in three steps, which is now what ContextSection does in buyer
 * language, and the depth link it carried moved there with it. The component
 * is still in the tree and still used nowhere else; retiring the file is a
 * separate decision.
 *
 * ClosingCta is the page's own final call, so the layout's shared CtaBanner is
 * suppressed here. Two competing closing offers is one too many.
 */
export default function HomePage() {
  return (
    <>
      <HeroSection />
      <ContextSection />
      <ProductPreview />
      <UseCases />
      <GovernanceCallout />
      <ClosingCta />
    </>
  );
}
