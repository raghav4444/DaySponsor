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

export default function Home() {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main>
        <Hero />
        <StatsBar />
        <FeaturedCreators />
        <HowItWorks />
        <LiveActivity />
        <ExperienceSection />
        <TrustSection />
        <DualCTA />
        <FinalCTA />
      </main>
      <Footer />
    </div>
  );
}
