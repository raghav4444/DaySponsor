import { Navbar } from '@/components/site/navbar';
import { Hero } from '@/components/site/hero';
import { StatsBar } from '@/components/site/stats-bar';
import { FeaturedCreators } from '@/components/site/featured-creators';
import { HowItWorks } from '@/components/site/how-it-works';
import { LiveActivity } from '@/components/site/live-activity';
import { ExperienceSection } from '@/components/site/experience-section';
import { TrustSection } from '@/components/site/trust-section';
import { DualCTA } from '@/components/site/dual-cta';
import { FinalCTA } from '@/components/site/final-cta';
import { Footer } from '@/components/site/footer';
import { ProblemSection } from '@/components/site/problem-section';
import { SponsoredDaySection } from '@/components/site/sponsored-day-section';
import { OpinionSection } from '@/components/site/opinion-section';
import { ValueSection } from '@/components/site/value-section';
import { TransparencySection } from '@/components/site/transparency-section';

export default function Home() {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main>
        <Hero />
        <StatsBar />
        <ProblemSection />
        <FeaturedCreators />
        <SponsoredDaySection />
        <HowItWorks />
        <LiveActivity />
        <ExperienceSection />
        <OpinionSection />
        <ValueSection />
        <TrustSection />
        <DualCTA />
        <TransparencySection />
        <FinalCTA />
      </main>
      <Footer />
    </div>
  );
}
