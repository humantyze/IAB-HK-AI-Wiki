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
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="flex flex-col items-center space-y-4">
          <div className="w-10 h-10 border-2 border-[#D63425]/20 border-t-[#D63425] rounded-full animate-spin" />
          <p style={{ color: '#B6B6B6', fontSize: '11px', fontFamily: 'Montserrat', letterSpacing: '0.2em', textTransform: 'uppercase' }}>Loading Report</p>
        </div>
      </div>
    );
  }

  const sortedSections = sections?.sort((a, b) => a.displayOrder - b.displayOrder) || [];

  return (
    <div className="min-h-screen bg-white" style={{ fontFamily: 'Montserrat, sans-serif' }}>
      {/* Mobile Header */}
      <div className="lg:hidden fixed top-0 left-0 right-0 h-16 bg-white z-50 border-b border-[#e5e7eb] flex items-center px-6 justify-between">
        <span style={{ fontFamily: 'Montserrat', fontWeight: 700, fontSize: '16px', color: '#4a4a4a', letterSpacing: '0.05em' }}>STATE OF AI</span>
        <Button variant="ghost" size="icon" onClick={() => setSidebarOpen(!sidebarOpen)} style={{ color: '#D63425' }}>
          <Menu className="w-6 h-6" />
        </Button>
      </div>

      {/* Hero Section */}
      <section className="relative min-h-[70vh] flex items-center px-6 lg:px-24 pt-20 lg:pt-0 overflow-hidden bg-white border-b border-[#e5e7eb]">
        <div className="absolute inset-0 z-0 pointer-events-none">
          <img
            src={`${import.meta.env.BASE_URL}images/hero-bg.png`}
            alt="Hong Kong Skyline"
            className="w-full h-full object-cover opacity-5"
          />
        </div>

        <div className="relative z-10 max-w-5xl py-20">
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="inline-flex items-center space-x-2 border border-[#D63425]/30 bg-[#D63425]/5 px-4 py-1.5 rounded-full mb-8">
              <span className="w-1.5 h-1.5 rounded-full bg-[#D63425]" />
              <span style={{ fontFamily: 'Montserrat', fontWeight: 600, fontSize: '10px', color: '#D63425', letterSpacing: '0.15em', textTransform: 'uppercase' }}>IAB Hong Kong Web Book</span>
            </div>

            <h1 style={{ fontFamily: 'Montserrat', fontWeight: 800, fontSize: '32px', color: '#3b3b3b', lineHeight: 1.2, marginBottom: '24px', letterSpacing: '-0.01em' }}>
              STATE OF AI IN{' '}
              <span style={{ color: '#D63425' }}>HONG KONG'S</span>{' '}
              MARKETING INDUSTRY
            </h1>

            <p style={{ fontFamily: 'Montserrat', fontSize: '16px', color: '#4d4d4d', fontWeight: 400, lineHeight: 1.8, maxWidth: '640px', marginBottom: '40px' }}>
              A living exploration of AI adoption, transformational use cases, and the evolving regulatory landscape shaping the future of digital experiences in Hong Kong. With continuous updates from IAB Hong Kong members.
            </p>

            <div className="flex flex-wrap items-center gap-4">
              <Button
                size="lg"
                style={{ backgroundColor: '#D63425', color: '#ffffff', borderRadius: '4px', fontFamily: 'Montserrat', fontWeight: 600, fontSize: '14px', letterSpacing: '0.05em', height: '48px', paddingLeft: '28px', paddingRight: '28px', border: 'none' }}
                onClick={() => {
                  document.getElementById(`section-${sortedSections[0]?.slug}`)?.scrollIntoView({ behavior: 'smooth' });
                }}
              >
                Access Report <ArrowRight className="ml-2 w-4 h-4" />
              </Button>

              <Link href="/visual">
                <Button
                  size="lg"
                  variant="outline"
                  style={{ borderColor: '#D63425', color: '#D63425', backgroundColor: 'transparent', borderRadius: '4px', fontFamily: 'Montserrat', fontWeight: 600, fontSize: '14px', letterSpacing: '0.05em', height: '48px', paddingLeft: '28px', paddingRight: '28px' }}
                >
                  <BarChart3 className="mr-2 w-4 h-4" /> Visual Summary
                </Button>
              </Link>

              <Link href="/admin/login">
                <span className="inline-flex items-center gap-2 cursor-pointer" style={{ color: '#B6B6B6', fontFamily: 'Montserrat', fontSize: '11px', letterSpacing: '0.15em', textTransform: 'uppercase', transition: 'color 0.2s' }}
                  onMouseEnter={e => (e.currentTarget.style.color = '#D63425')}
                  onMouseLeave={e => (e.currentTarget.style.color = '#B6B6B6')}
                >
                  <Lock className="w-3.5 h-3.5" />
                  Contributor Access
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
          fixed lg:sticky top-0 lg:top-0 left-0 h-screen w-72
          bg-white lg:bg-[#fafafa] border-r border-[#e5e7eb] p-8 pt-24 lg:pt-16
          transform transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] z-40
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
          overflow-y-auto
        `}>
          <h3 style={{ fontFamily: 'Montserrat', fontWeight: 600, fontSize: '11px', color: '#B6B6B6', letterSpacing: '0.25em', textTransform: 'uppercase', marginBottom: '24px', paddingLeft: '8px' }}>Table of Contents</h3>
          <nav className="space-y-1">
            {sortedSections.map((section, idx) => (
              <button
                key={section.id}
                onClick={() => {
                  document.getElementById(`section-${section.slug}`)?.scrollIntoView({ behavior: 'smooth' });
                  setSidebarOpen(false);
                }}
                className="w-full text-left py-2.5 px-3 rounded-lg transition-all duration-200 flex items-start justify-between group"
                style={{
                  backgroundColor: activeSection === section.slug ? '#D6342510' : 'transparent',
                  borderLeft: `2px solid ${activeSection === section.slug ? '#D63425' : 'transparent'}`,
                }}
              >
                <span className="flex items-start">
                  <span style={{ fontFamily: 'Montserrat', fontWeight: 600, fontSize: '10px', color: activeSection === section.slug ? '#D63425' : '#B6B6B6', marginTop: '2px', marginRight: '12px', width: '16px', textAlign: 'right' }}>
                    {String(idx + 1).padStart(2, '0')}
                  </span>
                  <span style={{ fontFamily: 'Montserrat', fontSize: '13px', color: activeSection === section.slug ? '#4a4a4a' : '#B6B6B6', fontWeight: activeSection === section.slug ? 600 : 400, lineHeight: 1.4 }}>
                    {section.title}
                  </span>
                </span>
                {activeSection === section.slug && (
                  <ChevronRight className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color: '#D63425' }} />
                )}
              </button>
            ))}
          </nav>
        </aside>

        {/* Sections Content */}
        <main className="flex-1 px-6 lg:px-16 py-12 lg:py-20">
          {sortedSections.map((section, idx) => (
            <section
              key={section.id}
              id={`section-${section.slug}`}
              className="scroll-mt-20 relative mb-24"
            >
              <div className="relative max-w-4xl">
                <div className="mb-10">
                  <div className="flex items-center gap-3 mb-4">
                    <span style={{ fontFamily: 'Montserrat', fontSize: '11px', color: '#B6B6B6', fontWeight: 500, letterSpacing: '0.15em', textTransform: 'uppercase' }}>
                      Section {String(idx + 1).padStart(2, '0')}
                    </span>
                    <span style={{ width: '3px', height: '3px', borderRadius: '50%', backgroundColor: '#B6B6B6', display: 'inline-block' }} />
                    <span style={{ fontFamily: 'Montserrat', fontSize: '11px', color: '#B6B6B6', fontWeight: 500, letterSpacing: '0.1em' }}>
                      Updated {format(new Date(section.lastUpdated), 'MMM dd, yyyy')}
                    </span>
                  </div>
                  <h2 style={{ fontFamily: 'Montserrat', fontWeight: 700, fontSize: '32px', color: '#3b3b3b', lineHeight: 1.25 }}>
                    {section.title}
                  </h2>
                </div>

                {/* Key Insights */}
                {section.keyInsights && section.keyInsights.length > 0 && (
                  <div className="mb-10 p-6 rounded-xl border-l-4 border-[#D63425] bg-[#D63425]/5">
                    <h3 style={{ fontFamily: 'Montserrat', fontWeight: 700, fontSize: '11px', color: '#D63425', letterSpacing: '0.2em', textTransform: 'uppercase', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#D63425', display: 'inline-block' }} />
                      Key Insights
                    </h3>
                    <ul className="space-y-4">
                      {section.keyInsights.map((insight, i) => (
                        <li key={i} className="flex items-start gap-3">
                          <span style={{ fontFamily: 'Montserrat', fontWeight: 600, fontSize: '10px', color: '#D63425', marginTop: '2px', minWidth: '20px' }}>0{i + 1}</span>
                          <span style={{ fontFamily: 'Montserrat', fontSize: '16px', color: '#4d4d4d', lineHeight: 1.7, fontWeight: 400 }}>{insight}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Markdown Content */}
                <div className="prose prose-lg max-w-none"
                  style={{ fontFamily: 'Montserrat, sans-serif' }}
                >
                  <style>{`
                    .prose h1, .prose h2 { font-family: Montserrat, sans-serif; font-weight: 700; font-size: 32px; color: #3b3b3b; }
                    .prose h3, .prose h4 { font-family: Montserrat, sans-serif; font-weight: 600; font-size: 16px; color: #4a4a4a; }
                    .prose p, .prose li { font-family: Montserrat, sans-serif; font-size: 16px; color: #4d4d4d; line-height: 1.8; font-weight: 400; }
                    .prose strong { color: #4a4a4a; font-weight: 600; }
                    .prose a { color: #D63425; text-decoration: underline; text-underline-offset: 3px; }
                    .prose a:hover { color: #c0392b; }
                    .prose blockquote { border-left-color: #D63425; color: #D63425; }
                    .prose blockquote p { color: #D63425; }
                    .prose hr { border-color: #e5e7eb; }
                    .prose code { background: #f5f5f5; color: #4a4a4a; border-radius: 3px; padding: 2px 5px; font-size: 14px; }
                  `}</style>
                  <ReactMarkdown>{section.bodyMarkdown}</ReactMarkdown>
                </div>

                {/* Data Visualization */}
                {(section.slug.includes('adoption') || section.slug.includes('market') || section.slug.includes('future')) && (
                  <ChartPlaceholder />
                )}
              </div>

              {/* Section divider */}
              {idx < sortedSections.length - 1 && (
                <div className="max-w-4xl mt-16">
                  <div className="h-px bg-[#e5e7eb]" />
                </div>
              )}
            </section>
          ))}
        </main>
      </div>

      {/* Footer */}
      <footer className="border-t border-[#e5e7eb] py-12 px-6 bg-[#fafafa]">
        <div className="max-w-[1600px] mx-auto flex flex-col md:flex-row justify-between items-center gap-6">
          <div style={{ fontFamily: 'Montserrat', fontWeight: 800, fontSize: '16px', color: '#B6B6B6', letterSpacing: '0.1em' }}>
            STATE OF AI / HK
          </div>
          <div className="flex flex-col md:flex-row items-center gap-6">
            <button
              onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
              style={{ fontFamily: 'Montserrat', fontSize: '11px', color: '#B6B6B6', letterSpacing: '0.15em', textTransform: 'uppercase', background: 'none', border: 'none', cursor: 'pointer', transition: 'color 0.2s' }}
              onMouseEnter={e => (e.currentTarget.style.color = '#D63425')}
              onMouseLeave={e => (e.currentTarget.style.color = '#B6B6B6')}
            >
              Return to Top
            </button>
            <Link href="/admin" style={{ fontFamily: 'Montserrat', fontSize: '11px', color: '#B6B6B6', letterSpacing: '0.15em', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '8px', textDecoration: 'none', transition: 'color 0.2s' }}
              onMouseEnter={e => (e.currentTarget.style.color = '#D63425')}
              onMouseLeave={e => (e.currentTarget.style.color = '#B6B6B6')}
            >
              <span style={{ width: '5px', height: '5px', borderRadius: '50%', backgroundColor: 'currentColor', display: 'inline-block' }} />
              Contributor Access
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
