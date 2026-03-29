import { Link } from "wouter";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-secondary/5 z-0" />
      <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_50%_50%_at_50%_50%,#000_70%,transparent_100%)] opacity-30 z-0" />
      
      <div className="relative z-10 text-center max-w-lg mx-auto p-6">
        <h1 className="text-[10rem] md:text-[14rem] font-black font-display leading-none text-transparent bg-clip-text bg-gradient-to-b from-foreground/80 to-background mb-8 drop-shadow-2xl">
          404
        </h1>
        <h2 className="text-2xl md:text-3xl font-serif font-bold text-foreground/90 mb-4 tracking-wide">Vector Not Found</h2>
        <p className="text-muted-foreground mb-12 font-light leading-relaxed">
          The requested data sector could not be located in the current database index. The coordinates may have shifted during recent AI integrations.
        </p>
        <Link href="/">
          <Button size="lg" className="h-14 px-10 font-display uppercase tracking-[0.2em] text-xs bg-primary/10 hover:bg-primary text-primary hover:text-primary-foreground border border-primary/30 rounded-xl transition-all duration-300 shadow-[0_0_20px_rgba(0,240,255,0.1)] hover:shadow-[0_0_40px_rgba(0,240,255,0.3)]">
            Return to Index
          </Button>
        </Link>
      </div>
    </div>
  );
}
