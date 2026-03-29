import { useState, useEffect } from "react";
import { Link } from "wouter";
import { motion } from "framer-motion";
import ReactMarkdown from "react-markdown";
import { format } from "date-fns";
import { ArrowRight, ChevronRight, Menu, Lock, BarChart3 } from "lucide-react";
import { useSections } from "@/hooks/use-sections";
import { Button } from "@/components/ui/button";
import { ChartPlaceholder } from "@/components/ChartPlaceholder";

export default function PublicReport() {
  const { data: sections, isLoading } = useSections();
  const [activeSection, setActiveSection] = useState<string>("");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      if (!sections) return;
      
      const scrollPosition = window.scrollY;
      
      let current = sections[0]?.slug;
      for (const section of sections) {
        const element = document.getElementById(`section-${section.slug}`);
        if (element && element.offsetTop <= scrollPosition + 300) {
          current = section.slug;
        }
      }
      setActiveSection(current);
    };

    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, [sections]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-secondary/5 z-0" />
        <div className="relative z-10 flex flex-col items-center space-y-6">
          <div className="relative w-24 h-24">
            <div className="absolute inset-0 border-4 border-primary/20 rounded-full" />
            <div className="absolute inset-0 border-4 border-primary border-t-transparent rounded-full animate-spin" />
            <div className="absolute inset-2 border-4 border-secondary/20 rounded-full" />
            <div className="absolute inset-2 border-4 border-secondary border-b-transparent rounded-full animate-[spin_2s_linear_reverse_infinite]" />
          </div>
          <p className="text-primary font-display uppercase tracking-[0.3em] text-sm animate-pulse">Initializing Data Stream</p>
        </div>
      </div>
    );
  }

  const sortedSections = sections?.sort((a, b) => a.displayOrder - b.displayOrder) || [];

  return (
    <div className="min-h-screen bg-background text-foreground selection:bg-primary/30 selection:text-primary">
      {/* Mobile Header */}
      <div className="lg:hidden fixed top-0 left-0 right-0 h-16 bg-background/80 backdrop-blur-xl z-50 border-b border-border flex items-center px-6 justify-between">
        <span className="font-serif font-bold text-lg tracking-widest text-foreground/80">STATE OF AI</span>
        <Button variant="ghost" size="icon" onClick={() => setSidebarOpen(!sidebarOpen)} className="text-primary">
          <Menu className="w-6 h-6" />
        </Button>
      </div>
      {/* Hero Section */}
      <section className="relative min-h-screen flex items-center px-6 lg:px-24 pt-20 lg:pt-0 overflow-hidden">
        <div className="absolute inset-0 z-0">
          <img 
            src={`${import.meta.env.BASE_URL}images/hero-bg.png`} 
            alt="Futuristic Hong Kong Skyline" 
            className="w-full h-full object-cover opacity-30 mix-blend-luminosity"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-background via-background/80 to-transparent" />
          <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_50%,#000_70%,transparent_100%)] opacity-30" />
        </div>
        
        <div className="relative z-10 max-w-5xl">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="inline-flex items-center space-x-3 bg-primary/5 border border-primary/30 px-5 py-2 rounded-full text-xs font-display tracking-[0.2em] uppercase mb-8 backdrop-blur-sm">
              <span className="w-2 h-2 rounded-full bg-primary shadow-[0_0_10px_rgba(0,240,255,0.8)] animate-pulse" />
              <span className="text-primary/90">March 2026 | Research Report</span>
            </div>
            <h1 className="text-6xl md:text-7xl lg:text-8xl font-serif font-black leading-[1.05] tracking-tighter mb-8 text-foreground/90">
              STATE OF AI IN<br/>
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary via-accent to-secondary">HONG KONG</span><br/>
              MARKETING
            </h1>
            <p className="text-xl md:text-2xl text-muted-foreground font-light max-w-3xl leading-relaxed mb-12">A living exploration of AI adoption, transformational use cases, and the evolving regulatory landscape shaping the future of digital experiences in Hong Kong. 

            With continuous updates from IAB Hong Kong members.</p>
            
            <div className="flex flex-wrap items-center gap-4">
              <Button 
                size="lg" 
                className="h-14 px-8 font-display uppercase tracking-[0.15em] text-sm rounded-none border border-primary/50 bg-primary/10 hover:bg-primary text-primary hover:text-primary-foreground transition-all duration-500 shadow-[0_0_20px_rgba(0,240,255,0.15)] hover:shadow-[0_0_40px_rgba(0,240,255,0.4)]"
                onClick={() => {
                  document.getElementById(`section-${sortedSections[0]?.slug}`)?.scrollIntoView({ behavior: 'smooth' });
                }}
              >
                Access Report <ArrowRight className="ml-3 w-4 h-4" />
              </Button>

              <Link href="/visual">
                <Button
                  size="lg"
                  variant="outline"
                  className="h-14 px-8 font-display uppercase tracking-[0.15em] text-sm rounded-none border border-secondary/50 bg-secondary/5 hover:bg-secondary/15 text-secondary hover:text-secondary transition-all duration-500 shadow-[0_0_20px_rgba(255,0,255,0.08)] hover:shadow-[0_0_40px_rgba(255,0,255,0.25)]"
                >
                  <BarChart3 className="mr-3 w-4 h-4" /> Visual Summary
                </Button>
              </Link>

              <Link href="/admin/login">
                <span className="group inline-flex items-center gap-2 text-muted-foreground/50 hover:text-primary transition-colors duration-300 cursor-pointer">
                  <Lock className="w-4 h-4 group-hover:shadow-[0_0_8px_rgba(0,240,255,0.6)] transition-all duration-300" />
                  <span className="font-display uppercase tracking-[0.2em] text-[10px]">Contributor Access</span>
                </span>
              </Link>
            </div>
          </motion.div>
        </div>
      </section>
      {/* Main Content Layout */}
      <div className="max-w-[1800px] mx-auto flex flex-col lg:flex-row relative">
        
        {/* Sidebar Navigation */}
        <aside className={`
          fixed lg:sticky top-0 lg:top-0 left-0 h-screen w-80 
          bg-card/95 lg:bg-transparent backdrop-blur-2xl lg:backdrop-blur-none
          border-r border-border/50 p-8 pt-24 lg:pt-32
          transform transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] z-40
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
          overflow-y-auto
        `}>
          <h3 className="font-display font-semibold text-[10px] tracking-[0.3em] text-muted-foreground uppercase mb-10 pl-4">Table of Contents</h3>
          <nav className="space-y-2">
            {sortedSections.map((section, idx) => (
              <button
                key={section.id}
                onClick={() => {
                  document.getElementById(`section-${section.slug}`)?.scrollIntoView({ behavior: 'smooth' });
                  setSidebarOpen(false);
                }}
                className={`
                  w-full text-left py-3 px-4 rounded-lg transition-all duration-300 text-sm group flex items-start justify-between
                  ${activeSection === section.slug 
                    ? 'bg-primary/10 text-primary font-medium border-l-2 border-primary shadow-[inset_20px_0_40px_rgba(0,240,255,0.05)]' 
                    : 'text-muted-foreground hover:bg-accent/5 hover:text-foreground border-l-2 border-transparent'}
                `}
              >
                <span className="flex items-start">
                  <span className={`font-display text-[10px] mt-1 mr-4 w-4 text-right transition-colors ${activeSection === section.slug ? 'text-primary' : 'text-muted-foreground/50'}`}>
                    {String(idx + 1).padStart(2, '0')}
                  </span>
                  <span className="leading-tight pr-2">{section.title}</span>
                </span>
                {activeSection === section.slug && (
                  <ChevronRight className="w-4 h-4 mt-0.5 opacity-50 shrink-0" />
                )}
              </button>
            ))}
          </nav>
        </aside>

        {/* Sections Content */}
        <main className="flex-1 px-6 lg:px-24 py-16 lg:py-32">
          {sortedSections.map((section, idx) => (
            <section 
              key={section.id} 
              id={`section-${section.slug}`}
              className="scroll-mt-32 relative mb-48"
            >
              {/* Decorative Section Number */}
              <div className="absolute -left-16 -top-16 text-[12rem] font-black font-display text-muted/10 select-none z-0 pointer-events-none">
                {String(idx + 1).padStart(2, '0')}
              </div>

              <div className="relative z-10 max-w-4xl">
                <div className="mb-16">
                  <div className="flex items-center space-x-4 text-xs text-muted-foreground font-display tracking-[0.2em] uppercase mb-6">
                    <span>Section {String(idx + 1).padStart(2, '0')}</span>
                    <span className="w-1 h-1 rounded-full bg-primary/50" />
                    <span>Updated {format(new Date(section.lastUpdated), 'MMM dd, yyyy')}</span>
                  </div>
                  <h2 className="text-4xl lg:text-5xl font-serif font-bold text-foreground/90 leading-[1.2]">{section.title}</h2>
                </div>

                {/* Key Insights Highlight */}
                {section.keyInsights && section.keyInsights.length > 0 && (
                  <div className="mb-16 p-8 border-l border-secondary/50 bg-gradient-to-r from-secondary/5 to-transparent relative overflow-hidden rounded-r-3xl">
                    <div className="absolute -top-20 -right-20 w-64 h-64 bg-secondary/10 blur-[80px] rounded-full pointer-events-none" />
                    <h3 className="font-display font-bold text-secondary uppercase tracking-[0.2em] text-xs mb-8 flex items-center">
                      <div className="w-1.5 h-1.5 bg-secondary shadow-[0_0_10px_rgba(255,0,255,0.8)] mr-4" />
                      Key Insights Extracted
                    </h3>
                    <ul className="space-y-6 relative z-10">
                      {section.keyInsights.map((insight, i) => (
                        <li key={i} className="flex items-start group">
                          <span className="text-secondary/60 mr-4 mt-1 font-display text-[10px] tracking-widest">0{i+1}</span>
                          <span className="text-foreground/80 font-medium leading-relaxed group-hover:text-foreground transition-colors">{insight}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Markdown Content */}
                <div className="prose prose-invert prose-lg max-w-none 
                  prose-headings:font-serif prose-headings:font-bold prose-headings:text-foreground/90 
                  prose-h3:text-primary prose-h3:font-display prose-h3:tracking-wide prose-h3:uppercase prose-h3:text-sm prose-h3:mt-12
                  prose-a:text-primary hover:prose-a:text-primary/80 prose-a:decoration-primary/30 prose-a:underline-offset-4
                  prose-p:text-muted-foreground prose-p:font-light prose-p:leading-[1.8]
                  prose-li:text-muted-foreground prose-li:font-light
                  prose-strong:text-foreground/90 prose-strong:font-semibold">
                  <ReactMarkdown>{section.bodyMarkdown}</ReactMarkdown>
                </div>

                {/* Data Visualization Placeholder for certain sections */}
                {(section.slug.includes('adoption') || section.slug.includes('market') || section.slug.includes('future')) && (
                  <ChartPlaceholder />
                )}
              </div>
              
              {/* Divider between sections */}
              {idx < sortedSections.length - 1 && (
                <div className="max-w-4xl h-px bg-gradient-to-r from-primary/20 via-transparent to-transparent mt-32" />
              )}
            </section>
          ))}
        </main>

      </div>
      {/* Footer */}
      <footer className="border-t border-border/50 py-16 px-6 relative overflow-hidden bg-card/50">
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:2rem_2rem] opacity-50 z-0 pointer-events-none" />
        <div className="max-w-[1600px] mx-auto flex flex-col md:flex-row justify-between items-center relative z-10">
          <div className="font-serif font-bold text-3xl tracking-widest text-foreground/20 mb-8 md:mb-0 select-none">
            STATE OF AI / HK
          </div>
          <div className="flex flex-col md:flex-row items-center space-y-4 md:space-y-0 md:space-x-12 text-xs font-display tracking-[0.2em] uppercase">
            <button 
              onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
              className="text-muted-foreground hover:text-primary transition-colors flex items-center"
            >
              Return to Top
            </button>
            <Link href="/admin" className="text-secondary/60 hover:text-secondary transition-colors flex items-center group">
              <span className="w-1.5 h-1.5 rounded-full bg-secondary/60 group-hover:bg-secondary mr-3 transition-colors" />
              Contributor Access
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
