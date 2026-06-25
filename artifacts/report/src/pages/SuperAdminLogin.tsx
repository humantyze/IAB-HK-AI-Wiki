import { useState, useEffect } from "react";
import { useSuperAuth } from "@/hooks/use-super-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { motion } from "framer-motion";
import { Link, useLocation } from "wouter";

export default function SuperAdminLogin() {
  const [password, setPassword] = useState("");
  const { login, isLoggingIn, isAuthenticated, isLoading: authLoading } = useSuperAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      setLocation("/super-admin");
    }
  }, [authLoading, isAuthenticated, setLocation]);

  if (authLoading) return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
    </div>
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await login(password);
      toast({ title: "Authorization Granted", description: "Secure session established." });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Invalid security credential.";
      toast({
        title: "Access Denied",
        description: message,
        variant: "destructive",
      });
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background relative overflow-hidden px-4">
      <div className="absolute inset-0 z-0 opacity-10 mix-blend-screen pointer-events-none">
        <img src={`${import.meta.env.BASE_URL}images/abstract-neon.png`} alt="Abstract Neon" className="w-full h-full object-cover" />
      </div>
      <div className="absolute top-1/4 -left-32 w-[500px] h-[500px] bg-accent/20 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-1/4 -right-32 w-[500px] h-[500px] bg-secondary/20 rounded-full blur-[120px] pointer-events-none" />
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        className="z-10 w-full max-w-md"
      >
        <Card className="bg-card/40 backdrop-blur-2xl border-border/50 shadow-[0_0_50px_rgba(0,0,0,0.5)] rounded-2xl overflow-hidden relative">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-accent via-secondary to-primary" />
          <CardHeader className="text-center pb-8 pt-10">
            <div className="mx-auto mb-6 flex items-center justify-center">
              <img
                src={`${import.meta.env.BASE_URL}images/iabhk-logo.png`}
                alt="IAB HK"
                className="h-16 w-auto object-contain"
              />
            </div>
            <CardTitle className="font-serif text-3xl font-bold tracking-tight text-foreground/90">ADMIN PANEL</CardTitle>
            <CardDescription className="font-display tracking-[0.2em] uppercase text-[10px] mt-4 text-muted-foreground">
              State of AI Report • Restricted Access
            </CardDescription>
          </CardHeader>
          <CardContent className="px-8 pb-10">
            <form onSubmit={handleSubmit} className="space-y-8">
              <div className="space-y-2 relative">
                <Input
                  type="password"
                  placeholder="Enter Admin Passcode"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="bg-background/50 border-border/50 h-14 text-center text-lg tracking-[0.3em] font-mono focus-visible:ring-accent/50 focus-visible:border-accent/50 transition-all rounded-xl"
                  required
                />
              </div>
              <Button
                type="submit"
                className="w-full h-14 font-display uppercase tracking-[0.2em] text-xs bg-accent/10 hover:bg-accent text-accent hover:text-accent-foreground border border-accent/30 rounded-xl transition-all duration-300"
                disabled={isLoggingIn}
              >
                {isLoggingIn ? "Authenticating..." : "Initialize Session"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <div className="mt-8 text-center">
          <Link href="/" className="text-muted-foreground hover:text-foreground text-xs font-display uppercase tracking-widest transition-colors">
            ← Return to Knowledge Base
          </Link>
        </div>
      </motion.div>
    </div>
  );
}
